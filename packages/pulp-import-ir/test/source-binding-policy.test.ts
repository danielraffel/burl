import { describe, expect, test } from 'vitest';
import { applySourceBindingPolicy, resolveSourceBindingPolicyAction } from '../src/source-binding-policy.js';
import type { IRNode } from '../src/types.js';

const node = (sourceId: string, children: IRNode[] = []): IRNode => ({
    tag: 'View', stable_anchor_id: `observed-dom:${sourceId}`, source_node_id: sourceId,
    children, provenance: { adapter: 'observed-dom', version: '1', ts: 'now' },
    raw_source: { kind: 'observed-dom', node: { sourceId, tagName: 'div', attributes: {} }, computedStyle: {} },
    confidence: 'PASS',
});

describe('source binding policy', () => {
    test('reconciles an exact reviewed source action alias', () => {
        const policy = { version: 1 as const, rules: [], actionAliases: [{
            sourceAction: 'source.session.create', applicationAction: 'navigation.new-session',
        }] };
        expect(resolveSourceBindingPolicyAction(policy, 'source.session.create',
            new Set(['navigation.new-session']))).toBe('navigation.new-session');
        expect(resolveSourceBindingPolicyAction(policy, 'navigation.new-session',
            new Set(['navigation.new-session']))).toBe('navigation.new-session');
    });

    test('action alias reconciliation fails closed on conflicts, chains, and unknown targets', () => {
        expect(() => resolveSourceBindingPolicyAction({ version: 1, rules: [], actionAliases: [
            { sourceAction: 'source.create', applicationAction: 'navigation.new' },
            { sourceAction: 'source.create', applicationAction: 'session.create' },
        ] }, 'source.create')).toThrow(/conflicting.*source.create/);
        expect(() => resolveSourceBindingPolicyAction({ version: 1, rules: [], actionAliases: [
            { sourceAction: 'source.create', applicationAction: 'intermediate.create' },
            { sourceAction: 'intermediate.create', applicationAction: 'navigation.new' },
        ] }, 'source.create')).toThrow(/transitive.*not allowed/);
        expect(() => resolveSourceBindingPolicyAction({ version: 1, rules: [], actionAliases: [
            { sourceAction: 'source.create', applicationAction: 'missing.action' },
        ] }, 'source.create', new Set(['navigation.new']))).toThrow(/target is absent/);
        expect(() => resolveSourceBindingPolicyAction({ version: 1, rules: [] },
            'unreviewed.action', new Set(['known.action']))).toThrow(/no reviewed alias/);
    });
    test('binds a node that exists only in an alternate application-state branch', () => {
        const closed = node('dom/html-old/body/div-id-root/div-data-slot-collapsible');
        const reasoning = node('dom/html-new/body/div-id-root/div-data-slot-collapsible/p-shape-reasoning');
        const root = node('dom/html-new/body', [closed, reasoning]);
        const receipt = applySourceBindingPolicy(root, { version: 1, rules: [{
            id: 'reasoning-text',
            match: { sourceId: 'dom/html-stale/body/div-id-root/div-data-slot-collapsible/p-shape-reasoning' },
            attributes: { pulpValueKey: 'reasoning.text', pulpValueKind: 'markdown' },
        }] });
        expect((reasoning as any).attributes).toMatchObject({
            pulpValueKey: 'reasoning.text', pulpValueKind: 'markdown',
            pulpBindingPolicyRule: 'reasoning-text',
        });
        expect(receipt).toEqual([{ id: 'reasoning-text', matchedNodes: 1,
            sourceIds: ['dom/html-new/body/div-id-root/div-data-slot-collapsible/p-shape-reasoning'] }]);
    });

    test('fails closed when a reviewed source identity is absent', () => {
        expect(() => applySourceBindingPolicy(node('dom/html/body'), { version: 1, rules: [{
            id: 'missing', match: { sourceId: 'dom/html/body/div-id-missing' }, attributes: { pulpValueKey: 'x' },
        }] })).toThrow(/resolved 0 candidates/);
    });

    test('state-scoped application reports unrelated rules without weakening ambiguity checks', () => {
        const reasoning = node('dom/html/body/div-id-root/p-shape-reasoning');
        const receipts = applySourceBindingPolicy(reasoning, { version: 1, rules: [{
            id: 'default-only', match: { sourceId: 'dom/html/body/div-id-root/button-id-default' },
            attributes: { pulpHostAction: 'default' },
        }, {
            id: 'reasoning', match: { sourceId: 'dom/html/body/div-id-root/p-shape-reasoning' },
            attributes: { pulpValueKey: 'reasoning.text' },
        }] }, { requireAllRules: false });
        expect(receipts).toEqual([
            { id: 'default-only', matchedNodes: 0, sourceIds: [] },
            { id: 'reasoning', matchedNodes: 1,
                sourceIds: ['dom/html/body/div-id-root/p-shape-reasoning'] },
        ]);
    });

    test('materializes a reviewed host action as a typed executable interaction', () => {
        const trigger = node('dom/html/body/button-data-slot-tooltip-trigger');
        applySourceBindingPolicy(trigger, { version: 1, rules: [{
            id: 'review-toggle',
            match: { sourceId: 'dom/html/body/button-data-slot-tooltip-trigger' },
            attributes: {
                pulpHostAction: 'review.panel.toggle',
                pulpEventContract: 'click-or-primary-modifier-shift-d',
                pulpPayloadContract: '{"panel":"review"}',
                pulpStateKey: 'review.panel.open',
                pulpStateTransition: 'cycle:closed,open',
            },
        }] });
        expect(trigger.interaction).toEqual({
            actionBindingId: 'review.panel.toggle', event: 'click', required: true,
            disabled: false, focusable: true, payloadContract: '{"panel":"review"}',
        });
    });

    test('exact source policy wins over a semantic-name heuristic and reports the losing collision', () => {
        const trigger = node('dom/html/body/button-data-slot-primary-action');
        (trigger.raw_source as any).node.tagName = 'button';
        (trigger.raw_source as any).node.text = 'Create item';
        const receipts = applySourceBindingPolicy(trigger, { version: 1, rules: [{
            id: 'exact-reviewed-route',
            match: { sourceId: 'dom/html/body/button-data-slot-primary-action' },
            attributes: { pulpHostAction: 'navigation.create-item', pulpEventContract: 'click' },
        }, {
            id: 'semantic-name-heuristic',
            match: { role: 'button', textExact: 'Create item' },
            attributes: { pulpHostAction: 'item.create', pulpEventContract: 'click' },
        }] });
        expect((trigger as any).attributes).toMatchObject({
            pulpHostAction: 'navigation.create-item',
            pulpBindingPolicyRule: 'exact-reviewed-route',
        });
        expect(trigger.interaction?.actionBindingId).toBe('navigation.create-item');
        expect(receipts[1].collisions).toEqual([{
            sourceId: 'dom/html/body/button-data-slot-primary-action',
            attribute: 'pulpHostAction',
            winningRuleId: 'exact-reviewed-route',
            losingRuleId: 'semantic-name-heuristic',
            winningValue: 'navigation.create-item',
            losingValue: 'item.create',
            resolution: 'more-specific-match',
        }]);
    });

    test('equally specific conflicting reviewed rules fail closed', () => {
        const trigger = node('dom/html/body/button-data-slot-primary-action');
        expect(() => applySourceBindingPolicy(trigger, { version: 1, rules: [{
            id: 'first', match: { sourceId: trigger.source_node_id },
            attributes: { pulpHostAction: 'first' },
        }, {
            id: 'second', match: { sourceId: trigger.source_node_id },
            attributes: { pulpHostAction: 'second' },
        }] })).toThrow(/binding policy collision.*equally specific/);
    });
});
