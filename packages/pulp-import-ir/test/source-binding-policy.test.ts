import { describe, expect, test } from 'vitest';
import { applySourceBindingPolicy } from '../src/source-binding-policy.js';
import type { IRNode } from '../src/types.js';

const node = (sourceId: string, children: IRNode[] = []): IRNode => ({
    tag: 'View', stable_anchor_id: `observed-dom:${sourceId}`, source_node_id: sourceId,
    children, provenance: { adapter: 'observed-dom', version: '1', ts: 'now' },
    raw_source: { kind: 'observed-dom', node: { sourceId, tagName: 'div', attributes: {} }, computedStyle: {} },
    confidence: 'PASS',
});

describe('source binding policy', () => {
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
});
