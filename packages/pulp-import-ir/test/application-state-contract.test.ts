import { describe, expect, test } from 'vitest';
import { attachApplicationStateActionTransitions, validateApplicationStatePolicyRules } from '../src/application-state-contract.js';
import type { IRNode } from '../src/types.js';

const domain = (values: string[]) => ({
    id: 'variants', attributes: {},
    applicationState: { key: 'panel.open', visibility: Object.fromEntries(values.map((value) => [value, true])) },
});
const action = (transition: string) => ({
    id: 'trigger', attributes: { pulpStateKey: 'panel.open', pulpStateTransition: transition },
});

describe('application-state policy contracts', () => {
    test('accepts boolean toggle only for a boolean domain', () => {
        expect(() => validateApplicationStatePolicyRules([domain(['true', 'false']), action('toggle')]))
            .not.toThrow();
        expect(() => validateApplicationStatePolicyRules([domain(['open', 'closed']), action('toggle')]))
            .toThrow(/boolean toggle for non-boolean state/);
    });

    test('requires explicit named cycles to cover the captured domain', () => {
        expect(() => validateApplicationStatePolicyRules([
            domain(['open', 'closed']), action('cycle:open,closed'),
        ])).not.toThrow();
        expect(() => validateApplicationStatePolicyRules([
            domain(['open', 'closed']), action('cycle:open,missing'),
        ])).toThrow(/does not match application-state domain/);
    });

    test('rejects incomplete, conflicting, and out-of-domain transitions', () => {
        expect(() => validateApplicationStatePolicyRules([
            domain(['open', 'closed']), action('set:true'),
        ])).toThrow(/does not match application-state domain/);
        expect(() => validateApplicationStatePolicyRules([
            domain(['open', 'closed']), { ...domain(['open']), id: 'conflict' },
        ])).toThrow(/conflicting domains/);
        expect(() => validateApplicationStatePolicyRules([
            domain(['open', 'closed']), { id: 'partial', attributes: { pulpStateKey: 'panel.open' } },
        ])).toThrow(/incomplete application-state transition/);
    });
});

const actionNode = (id: string, payload?: string): IRNode => ({
    tag: 'Button', stable_anchor_id: id, source_node_id: id, children: [],
    interaction: { actionBindingId: id, event: 'click', payloadContract: payload,
        required: true, disabled: false, focusable: true },
    provenance: { adapter: 'observed-dom', version: '1.0.0', ts: 'now' },
    raw_source: { kind: 'observed-dom', node: {}, computedStyle: {} }, confidence: 'PASS',
});

describe('application-state action transition attachment', () => {
    test('maps captured state payloads to named set transitions', () => {
        const root = actionNode('settings.theme.select', 'light');
        const report = attachApplicationStateActionTransitions(root, [{
            key: 'settings.theme', action: 'settings.theme.select', before: 'dark', after: 'light',
        }]);
        expect(root.meta).toMatchObject({ imported_state_key: 'settings.theme',
            imported_state_transition: 'set:light' });
        expect(root.interaction?.payloadContract).toBe('light');
        expect(report).toEqual([{ action: 'settings.theme.select', key: 'settings.theme',
            matchedNodes: 1, attachedNodes: 1, preservedNodes: 0 }]);
    });

    test('uses the observed destination when no state-valued payload exists', () => {
        const root = actionNode('session.metrics.dismiss');
        attachApplicationStateActionTransitions(root, [{
            key: 'session.metrics.open', action: 'session.metrics.dismiss', before: 'open', after: 'closed',
        }]);
        expect(root.meta).toMatchObject({ imported_state_key: 'session.metrics.open',
            imported_state_transition: 'set:closed' });
    });

    test('derives a named cycle from source-authored aria-expanded semantics', () => {
        const root = actionNode('disclosure.toggle');
        (root.raw_source.node as any).attributes = { 'aria-expanded': 'true' };
        attachApplicationStateActionTransitions(root, [{
            key: 'disclosure.open', action: 'disclosure.toggle', before: 'closed', after: 'open',
        }]);
        expect(root.meta).toMatchObject({ imported_state_key: 'disclosure.open',
            imported_state_transition: 'cycle:closed,open' });
    });

    test('does not infer reversibility without a source-authored state property', () => {
        const root = actionNode('panel.open');
        attachApplicationStateActionTransitions(root, [{
            key: 'panel.open', action: 'panel.open', before: 'closed', after: 'open',
        }]);
        expect(root.meta).toMatchObject({ imported_state_key: 'panel.open',
            imported_state_transition: 'set:open' });
    });

    test('preserves compatible public transitions and refuses missing or conflicting actions', () => {
        const root = actionNode('panel.toggle');
        root.meta = { imported_state_key: 'panel.open', imported_state_transition: 'cycle:closed,open' };
        expect(attachApplicationStateActionTransitions(root, [{
            key: 'panel.open', action: 'panel.toggle', before: 'closed', after: 'open',
        }])[0]).toMatchObject({ preservedNodes: 1, attachedNodes: 0 });
        expect(root.meta.imported_state_transition).toBe('cycle:closed,open');
        expect(() => attachApplicationStateActionTransitions(root, [{
            key: 'other', action: 'panel.toggle', before: 'closed', after: 'open',
        }])).toThrow('imported application-state key conflict');
        expect(() => attachApplicationStateActionTransitions(root, [{
            key: 'missing', action: 'missing.action', before: 'closed', after: 'open',
        }])).toThrow('has no imported node');
    });

    test('replaces a boolean toggle that cannot represent a captured named-state domain', () => {
        const root = actionNode('panel.toggle');
        root.meta = { imported_state_key: 'panel.open', imported_state_transition: 'toggle' };
        const report = attachApplicationStateActionTransitions(root, [{
            key: 'panel.open', action: 'panel.toggle', before: 'closed', after: 'open',
        }]);
        expect(root.meta).toMatchObject({ imported_state_key: 'panel.open',
            imported_state_transition: 'set:open' });
        expect(report[0]).toMatchObject({ preservedNodes: 0, attachedNodes: 1 });
    });

    test('normalizes materialized native action attributes with the same contract', () => {
        const root = actionNode('placeholder') as any;
        delete root.interaction;
        root.attributes = { pulpHostAction: 'panel.toggle', pulpStateKey: 'panel.open',
            pulpStateTransition: 'toggle' };
        attachApplicationStateActionTransitions(root, [
            { key: 'panel.open', action: 'panel.toggle', before: 'closed', after: 'open' },
            { key: 'panel.open', action: 'panel.toggle', before: 'open', after: 'closed' },
        ]);
        expect(root.attributes).toMatchObject({ pulpStateKey: 'panel.open',
            pulpStateTransition: 'cycle:closed,open' });
    });

    test('derives a named cycle from complete reverse-edge evidence', () => {
        const root = actionNode('sidebar.toggle');
        attachApplicationStateActionTransitions(root, [
            { key: 'sidebar.open', action: 'sidebar.toggle', before: 'open', after: 'closed' },
            { key: 'sidebar.open', action: 'sidebar.toggle', before: 'closed', after: 'open' },
        ]);
        expect(root.meta).toMatchObject({ imported_state_key: 'sidebar.open',
            imported_state_transition: 'cycle:open,closed' });
    });

    test('refuses incomplete and ambiguous multi-edge state graphs', () => {
        const root = actionNode('panel.advance');
        expect(() => attachApplicationStateActionTransitions(root, [
            { key: 'panel.step', action: 'panel.advance', before: 'one', after: 'two' },
            { key: 'panel.step', action: 'panel.advance', before: 'two', after: 'three' },
        ])).toThrow('incomplete transition cycle');
        expect(() => attachApplicationStateActionTransitions(root, [
            { key: 'panel.step', action: 'panel.advance', before: 'one', after: 'two' },
            { key: 'panel.step', action: 'panel.advance', before: 'one', after: 'three' },
        ])).toThrow('ambiguous transitions');
    });
});
