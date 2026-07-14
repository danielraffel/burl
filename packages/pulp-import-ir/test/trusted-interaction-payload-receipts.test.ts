import { describe, expect, it } from 'vitest';
import {
    applyTrustedInteractionPayloadReceipts,
    type IRNode,
} from '../src/index.js';

function node(id: string, role?: string, content?: string): IRNode {
    return {
        tag: 'frame',
        stable_anchor_id: id,
        source_node_id: id,
        children: content ? [{
            tag: 'text', stable_anchor_id: `${id}-text`, source_node_id: `${id}-text`,
            children: [], provenance: {}, raw_source: 'observed-dom', confidence: 1,
            content,
        } as any] : [],
        provenance: {}, raw_source: 'observed-dom', confidence: 1,
        ...(role ? { attributes: { role } } : {}),
    } as any;
}

function evidence(isTrusted = true) {
    return {
        scenarios: [{
            id: 'receipt-adaptive',
            binding: { action: 'composer.variant.select', payloadReceipt: { source: 'associated-control-value' } },
            action: { target: { role: 'option', name: 'Adaptive' } },
            payloadReceipt: { source: 'associated-control-value', value: 'Adaptive' },
            events: [{ type: 'click', isTrusted }],
        }],
    };
}

describe('trusted interaction payload receipts', () => {
    it('projects one trusted receipt onto every exact semantic duplicate', () => {
        const root = node('root');
        root.children = [node('adaptive-a', 'option', 'Adaptive'), node('adaptive-b', 'option', 'Adaptive')];
        const report = applyTrustedInteractionPayloadReceipts(root, evidence());
        expect(report.patchedNodeCount).toBe(2);
        expect(report.projections[0].sourceNodeIds).toEqual(['adaptive-a', 'adaptive-b']);
        for (const child of root.children) {
            expect(child.interaction?.actionBindingId).toBe('composer.variant.select');
            expect(child.interaction?.payloadContract).toBe('Adaptive');
            expect((child as any).attributes.pulpPayloadContract).toBe('Adaptive');
        }
    });

    it('rejects a receipt without a trusted click', () => {
        const root = node('root');
        root.children = [node('adaptive', 'option', 'Adaptive')];
        expect(() => applyTrustedInteractionPayloadReceipts(root, evidence(false))).toThrow(/lacks a trusted click/);
    });

    it('rejects a conflicting existing action', () => {
        const root = node('root');
        const adaptive = node('adaptive', 'option', 'Adaptive');
        adaptive.interaction = {
            actionBindingId: 'other.action', event: 'click', required: true,
            disabled: false, focusable: true,
        };
        root.children = [adaptive];
        expect(() => applyTrustedInteractionPayloadReceipts(root, evidence())).toThrow(/conflicts with other.action/);
    });
});
