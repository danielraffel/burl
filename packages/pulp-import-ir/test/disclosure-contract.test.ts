import { describe, expect, test } from 'vitest';
import type { ObservedDomNode } from '../src/adapters/observed-dom/lower.js';
import {
    extractObservedDisclosureContracts,
    materializeObservedDisclosureState,
} from '../src/disclosure-contract.js';
import { toNativeDesignIrV1 } from '../src/native-design-ir-v1.js';
import type { IRNode } from '../src/types.js';

const observed = (sourceId: string, attributes: Record<string, string>,
                  children: ObservedDomNode[] = [], visible = true): ObservedDomNode => ({
    sourceId, tagName: attributes['data-slot']?.endsWith('trigger') ? 'button' : 'div',
    attributes, computedStyle: {}, rect: visible
        ? { x: 10, y: 10, width: 100, height: 30 }
        : { x: 0, y: 0, width: 0, height: 0 },
    children,
});

const pair = () => {
    const closedTrigger = observed('trigger', {
        'data-slot': 'collapsible-trigger', 'aria-expanded': 'false',
    });
    const openContent = observed('content', {
        'data-slot': 'collapsible-content', id: 'panel', 'data-open': '',
    });
    const openTrigger = observed('trigger', {
        'data-slot': 'collapsible-trigger', 'aria-expanded': 'true', 'aria-controls': 'panel',
    });
    return {
        closed: observed('root', {}, [observed('host', {}, [closedTrigger])]),
        open: observed('root', {}, [observed('host', {}, [openTrigger, openContent])]),
    };
};

const ir = (id: string, children: IRNode[] = []): IRNode => ({
    tag: id === 'trigger' ? 'Button' : 'View', stable_anchor_id: id, source_node_id: id,
    children, provenance: { adapter: 'test', version: '1', ts: 'now' },
    raw_source: { kind: 'unknown', payload: {} }, confidence: 'PASS',
});

describe('observed disclosure contracts', () => {
    test('extracts an exact local relationship but records absent reverse evidence', () => {
        const { closed, open } = pair();
        const report = extractObservedDisclosureContracts(closed, open, [{
            targetSourceId: 'div:1/div:1/button:1', event: 'click', stateChanged: true,
        }]);
        expect(report.diagnostics).toEqual([]);
        expect(report.contracts).toHaveLength(1);
        expect(report.contracts[0]).toMatchObject({
            triggerNodeSourceId: 'trigger', contentSourceId: 'content',
            relationshipEvidence: 'aria-controls', transition: 'cycle:closed,open',
            gates: { reversibleTransitionObserved: false },
        });
    });

    test('rejects navigation or IPC as a local disclosure', () => {
        const { closed, open } = pair();
        const report = extractObservedDisclosureContracts(closed, open, [{
            targetSourceId: 'trigger', event: 'click', stateChanged: true,
            ipc: [{ channel: 'open-window', direction: 'invoke' }],
        }]);
        expect(report.contracts).toEqual([]);
        expect(report.diagnostics[0]?.code).toBe('disclosure-nonlocal-effect');
    });

    test('requires captured reversal before composing native state', () => {
        const { closed, open } = pair();
        const forward = extractObservedDisclosureContracts(closed, open, [{
            targetSourceId: 'trigger', event: 'click', stateChanged: true,
        }]).contracts[0]!;
        expect(() => materializeObservedDisclosureState(forward,
            ir('root', [ir('host', [ir('trigger')])]),
            ir('root', [ir('host', [ir('trigger'), ir('content')])]),
        )).toThrow(/no captured reversible transition/);

        const reversible = extractObservedDisclosureContracts(closed, open, [{
            targetSourceId: 'trigger', event: 'click', stateChanged: true,
        }], [{ event: 'trigger-toggle', closed: true, ariaExpanded: 'false', contentHidden: true }])
            .contracts[0]!;
        const materialized = materializeObservedDisclosureState(reversible,
            ir('root', [ir('host', [ir('trigger')])]),
            ir('root', [ir('host', [ir('trigger'), ir('content')])]),
        );
        const triggers: IRNode[] = [];
        const visit = (node: IRNode) => {
            if (node.source_node_id === 'trigger') triggers.push(node);
            node.children.forEach(visit);
        };
        visit(materialized);
        expect(triggers).toHaveLength(1);
        expect(triggers.every((node) => node.meta?.imported_state_transition === 'cycle:closed,open'))
            .toBe(true);
        const content = materialized.children[0]!.children.find((node) => node.source_node_id === 'content');
        expect(content?.responsive?.visibilityByApplicationState).toEqual({ closed: false, open: true });

        const native = toNativeDesignIrV1(
            materialized, { sourceFile: '/disclosure', importedAt: 'now' });
        const nativeHost = (native.root.children as Record<string, any>[])[0]!;
        const nativeTrigger = (nativeHost.children as Record<string, any>[])
            .find((node) => node.source_node_id === 'trigger')!;
        const nativeContent = (nativeHost.children as Record<string, any>[])
            .find((node) => node.source_node_id === 'content')!;
        expect(nativeTrigger.attributes).toMatchObject({
            pulpStateKey: 'source.disclosure:trigger',
            pulpStateTransition: 'cycle:closed,open',
            pulpDisclosureContentSourceId: 'content',
        });
        expect(nativeContent.responsive).toMatchObject({
            applicationStateKey: 'source.disclosure:trigger',
            visibilityByApplicationState: { closed: false, open: true },
        });
    });
});
