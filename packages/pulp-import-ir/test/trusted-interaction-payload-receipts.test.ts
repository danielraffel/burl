import { createHash } from 'node:crypto';
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

function commandEvidence({
    action = 'settings.theme.select',
    componentKey = 'cortex',
    disabled = false,
    identity = 'Theme: Cortex Cool',
    policy = 'reversible',
    trustedClickObserved = true,
}: {
    action?: string;
    componentKey?: string | null;
    disabled?: boolean;
    identity?: string;
    policy?: 'reversible' | 'navigation' | 'disabled' | 'unsafe';
    trustedClickObserved?: boolean;
} = {}) {
    const handlerSource = '()=>setTheme("cortex")';
    return {
        scenarios: [{
            id: 'command-receipt',
            binding: {
                action,
                activationReceipt: { source: 'command-item-runtime', policy },
                ...(componentKey === null ? {} : { payloadReceipt: { source: 'command-item-react-key' } }),
            },
            activationReceipt: {
                source: 'command-item-runtime', policy, identity, componentKey, disabled,
                commandIndex: 0, commandCount: 1,
                handlerSource,
                handlerSha256: createHash('sha256').update(handlerSource).digest('hex'),
                trustedClickObserved,
            },
            ...(componentKey === null ? {} : {
                payloadReceipt: { source: 'command-item-react-key', componentKey },
            }),
        }],
    };
}

function commandNode(id: string, content: string): IRNode {
    const result = node(id, 'option', content);
    (result as any).attributes.sourceDataSlot = 'command-item';
    return result;
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

    it('confines a receipt to its declared application-state frontier', () => {
        const root = node('root');
        const agent = node('agent-portal', 'group');
        const variant = node('variant-portal', 'group');
        agent.responsive = { visibility: [], layoutVariants: [], sampledViewports: [],
            applicationStateKey: 'composer.agent-menu.open' };
        variant.responsive = { visibility: [], layoutVariants: [], sampledViewports: [],
            applicationStateKey: 'composer.variant-menu.open' };
        agent.children = [node('agent-default', 'option', 'Default')];
        variant.children = [node('variant-default', 'option', 'Default')];
        root.children = [agent, variant];
        const scoped = evidence() as any;
        scoped.scenarios[0].binding.stateKey = 'composer.variant-menu.open';
        scoped.scenarios[0].action.target.name = 'Default';
        scoped.scenarios[0].payloadReceipt.value = '__default__';

        const report = applyTrustedInteractionPayloadReceipts(root, scoped);

        expect(report.projections[0]!.sourceNodeIds).toEqual(['variant-default']);
        expect(agent.children[0]!.interaction?.actionBindingId).toBeUndefined();
        expect(variant.children[0]!.interaction?.payloadContract).toBe('__default__');
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

    it('projects a source-owned command action and React-key payload after a trusted activation', () => {
        const root = node('root');
        root.children = [commandNode('cortex', 'Theme: Cortex Cool')];
        const report = applyTrustedInteractionPayloadReceipts(root, commandEvidence());
        expect(report.patchedNodeCount).toBe(1);
        expect(root.children[0].interaction).toMatchObject({
            actionBindingId: 'settings.theme.select', payloadContract: 'cortex', disabled: false,
        });
        expect((root.children[0] as any).attributes.pulpPayloadContract).toBe('cortex');
    });

    it('projects unsafe dynamic commands as disabled while preserving their source-owned React key', () => {
        const root = node('root');
        root.children = [commandNode('session', 'Add dark mode toggle to settings now')];
        applyTrustedInteractionPayloadReceipts(root, commandEvidence({
            action: 'session.open', componentKey: 'ses-mock-darkmode-001',
            identity: 'Add dark mode toggle to settings palot · 12m 56s · $0.02',
            policy: 'unsafe', trustedClickObserved: false,
        }));
        expect(root.children[0].interaction).toMatchObject({
            actionBindingId: 'session.open', payloadContract: 'ses-mock-darkmode-001', disabled: true,
        });
        expect((root.children[0] as any).attributes).toMatchObject({ disabled: 'true', accessibility_disabled: 'true' });
    });

    it('requires a disabled command receipt to prove the source control is disabled', () => {
        const root = node('root');
        root.children = [commandNode('compact', 'Compact Conversation')];
        expect(() => applyTrustedInteractionPayloadReceipts(root, commandEvidence({
            action: 'conversation.compact', componentKey: null, identity: 'Compact Conversation',
            policy: 'disabled', disabled: false, trustedClickObserved: false,
        }))).toThrow(/classified disabled without a disabled source control/);

        applyTrustedInteractionPayloadReceipts(root, commandEvidence({
            action: 'conversation.compact', componentKey: null, identity: 'Compact Conversation',
            policy: 'disabled', disabled: true, trustedClickObserved: false,
        }));
        expect(root.children[0].interaction?.disabled).toBe(true);
    });

    it('rejects a reversible command without a trusted activation', () => {
        const root = node('root');
        root.children = [commandNode('cortex', 'Theme: Cortex Cool')];
        expect(() => applyTrustedInteractionPayloadReceipts(root, commandEvidence({ trustedClickObserved: false })))
            .toThrow(/lacks a trusted click activation/);
    });

    it('rejects a command whose handler receipt hash does not match its source', () => {
        const root = node('root');
        root.children = [commandNode('cortex', 'Theme: Cortex Cool')];
        const receipt = commandEvidence();
        receipt.scenarios[0].activationReceipt.handlerSha256 = '0'.repeat(64);
        expect(() => applyTrustedInteractionPayloadReceipts(root, receipt))
            .toThrow(/incomplete or inconsistent runtime evidence/);
    });

    it('does not infer a command binding from a similar label', () => {
        const root = node('root');
        root.children = [commandNode('cortex', 'Theme: Cortex Warm')];
        expect(() => applyTrustedInteractionPayloadReceipts(root, commandEvidence()))
            .toThrow(/identity does not match its exact runtime command position/);
    });
});
