import { describe, expect, test } from 'vitest';
import {
    applyObservedOverlayContracts,
    extractObservedOverlayContracts,
    rebaseObservedOverlayContractContentIdentities,
    type ObservedDomNode,
} from '../src/index.js';

const node = (sourceId: string, attributes: Record<string, string> = {},
              children: ObservedDomNode[] = []): ObservedDomNode => ({
    sourceId, tagName: attributes.tagName ?? 'div', attributes, children,
    computedStyle: {}, rect: { x: 0, y: 0, width: 20, height: 20 },
});

describe('observed overlay contracts', () => {
    test('projects a portal tooltip from captured slot semantics without geometry matching', () => {
        const triggerClosed = node('stable-search', { tagName: 'button', 'data-slot': 'tooltip-trigger',
            'aria-label': 'Search projects' });
        const triggerOpen = structuredClone(triggerClosed);
        const closed = node('stable-html', { tagName: 'html' }, [
            node('stable-body', { tagName: 'body' }, [triggerClosed]),
        ]);
        const open = node('stable-html', { tagName: 'html' }, [
            node('stable-body', { tagName: 'body' }, [triggerOpen, node('portal', {}, [
            node('tip', { 'data-slot': 'tooltip-content', 'data-side': 'bottom',
                'data-align': 'center' }),
            ])]),
        ]);
        const report = extractObservedOverlayContracts(closed, open,
            [{ targetSourceId: 'html:1/body:1/button:1', event: 'hover', openDelayMs: 125 }]);
        expect(report.diagnostics).toEqual([]);
        expect(report.contracts[0]).toMatchObject({
            triggerSourceId: 'html:1/body:1/button:1', contentSourceId: 'tip', kind: 'tooltip',
            triggerNodeSourceId: 'stable-search',
            activationEvent: 'hover', relationshipEvidence: 'captured-slot-transition',
            timing: { openDelayMs: 125, evidence: 'captured-open-transition' },
            trigger: { accessibleName: 'Search projects' },
            content: { side: 'bottom', align: 'center' },
            gates: {
                openTransitionObserved: true,
                escapeDismissalObserved: false,
                outsidePointerDismissalObserved: false,
                focusRestorationObserved: false,
            },
        });
    });

    test('projects reviewed behavior onto stable trigger and content identities', () => {
        const root = {
            source_node_id: 'root', children: [
                { source_node_id: 'trigger', children: [], meta: { retained: true } },
                { source_node_id: 'content', children: [], meta: {}, style: { opacity: 0 } },
            ], meta: {},
        };
        const projected = applyObservedOverlayContracts(root, [{
            version: 1, triggerSourceId: 'html:1/button:1', triggerNodeSourceId: 'trigger',
            contentSourceId: 'content', kind: 'popover', activationEvent: 'click',
            anchor: { kind: 'trigger', evidence: 'activation-event' },
            timing: { openDelayMs: 0, evidence: 'captured-open-transition' },
            relationshipEvidence: 'aria-controls',
            trigger: { dataSlot: 'popover-trigger', accessibleName: 'Usage', ariaHasPopup: 'dialog',
                ariaExpandedClosed: 'false', ariaExpandedOpen: 'true' },
            content: { dataSlot: 'popover-content', role: 'dialog', side: 'bottom', align: 'end', items: [] },
            gates: { openTransitionObserved: true, triggerContentRelationshipObserved: true,
                escapeDismissalObserved: true, outsidePointerDismissalObserved: false,
                triggerToggleDismissalObserved: true, focusRestorationObserved: true },
        }]);
        expect(projected.children[0]!.meta).toMatchObject({
            retained: true, imported_overlay_kind: 'popover', imported_overlay_activation: 'click',
            imported_overlay_anchor: 'trigger',
            imported_overlay_content_source_id: 'content', imported_overlay_side: 'bottom',
            imported_overlay_open_delay_ms: 0,
            imported_overlay_align: 'end', imported_overlay_dismiss_escape: true,
            imported_overlay_dismiss_outside_pointer: false, imported_overlay_restore_focus: true,
        });
        expect(projected.children[1]!.meta).toMatchObject({
            imported_overlay_content: true, imported_overlay_trigger_source_id: 'trigger',
            imported_overlay_host_for: 'trigger',
        });
        expect(projected.children[0]!.attributes).toMatchObject({
            pulpOverlayKind: 'popover', pulpOverlayActivation: 'click',
            pulpOverlayContentSourceId: 'content', pulpOverlayDismissEscape: 'true',
            pulpOverlayDismissTriggerToggle: 'true', pulpOverlayRestoreFocus: 'true',
        });
        expect(projected.children[1]!.attributes).toMatchObject({
            pulpOverlayContent: 'true', pulpOverlayTriggerSourceId: 'trigger',
            pulpOverlayHostFor: 'trigger',
        });
        expect(projected.children[1]!.style).toEqual({ opacity: 1 });
        expect(projected.children[1]!.meta).toMatchObject({
            imported_overlay_open_endpoint_repair: 'zero-opacity-transition-start',
        });
        expect(root.children[0]!.meta).toEqual({ retained: true });
    });

    test('fails closed when stable materialization identities are missing or ambiguous', () => {
        const contract = {
            version: 1 as const, triggerSourceId: 'runtime', triggerNodeSourceId: 'trigger',
            contentSourceId: 'content', kind: 'tooltip' as const, activationEvent: 'hover' as const,
            anchor: { kind: 'trigger' as const, evidence: 'activation-event' as const },
            relationshipEvidence: 'aria-describedby' as const,
            timing: { openDelayMs: 0, evidence: 'captured-open-transition' as const },
            trigger: { dataSlot: null, accessibleName: '', ariaHasPopup: null,
                ariaExpandedClosed: null, ariaExpandedOpen: null },
            content: { dataSlot: null, role: 'tooltip', side: 'bottom', align: 'center', items: [] },
            gates: { openTransitionObserved: true as const, triggerContentRelationshipObserved: true as const,
                escapeDismissalObserved: false, outsidePointerDismissalObserved: false,
                triggerToggleDismissalObserved: false, focusRestorationObserved: false },
        };
        expect(() => applyObservedOverlayContracts({ source_node_id: 'root', children: [
            { source_node_id: 'trigger', children: [] },
        ] }, [contract])).toThrow(/content identity content matched 0 nodes/);
        expect(() => applyObservedOverlayContracts({ source_node_id: 'root', children: [
            { source_node_id: 'trigger', children: [] }, { source_node_id: 'trigger', children: [] },
            { source_node_id: 'content', children: [] },
        ] }, [contract])).toThrow(/trigger identity trigger matched 2 nodes/);
    });

    test('rebases a changed portal id only through a unique semantic slot and role', () => {
        const contract = {
            version: 1 as const, triggerSourceId: 'runtime', triggerNodeSourceId: 'trigger',
            contentSourceId: 'captured-content', kind: 'popover' as const,
            activationEvent: 'click' as const,
            anchor: { kind: 'trigger' as const, evidence: 'activation-event' as const },
            relationshipEvidence: 'aria-controls' as const,
            timing: { openDelayMs: 0, evidence: 'captured-open-transition' as const },
            trigger: { dataSlot: 'popover-trigger', accessibleName: '', ariaHasPopup: 'dialog',
                ariaExpandedClosed: 'false', ariaExpandedOpen: 'true' },
            content: { dataSlot: 'popover-content', role: 'dialog', side: 'bottom',
                align: 'end', items: [] },
            gates: { openTransitionObserved: true as const,
                triggerContentRelationshipObserved: true as const,
                escapeDismissalObserved: true, outsidePointerDismissalObserved: true,
                triggerToggleDismissalObserved: true, focusRestorationObserved: true },
        };
        const result = rebaseObservedOverlayContractContentIdentities({
            source_node_id: 'root', children: [
                { source_node_id: 'trigger', children: [], attributes: {} },
                { source_node_id: 'composed-content', children: [], attributes: {
                    sourceDataSlot: 'popover-content', role: 'dialog',
                } },
            ], attributes: {},
        }, [contract]);
        expect(result.contracts[0]!.contentSourceId).toBe('composed-content');
        expect(result.rebases).toEqual([{
            triggerNodeSourceId: 'trigger', capturedContentSourceId: 'captured-content',
            composedContentSourceId: 'composed-content', dataSlot: 'popover-content',
            role: 'dialog',
        }]);
        expect(() => rebaseObservedOverlayContractContentIdentities({
            source_node_id: 'root', children: [
                { source_node_id: 'one', children: [], attributes: {
                    sourceDataSlot: 'popover-content', role: 'dialog',
                } },
                { source_node_id: 'two', children: [], attributes: {
                    sourceDataSlot: 'popover-content', role: 'dialog',
                } },
            ], attributes: {},
        }, [contract])).toThrow(/semantic signature popover-content\/dialog matched 2 nodes/);
    });

    test('preserves popover semantics and only marks captured dismissal behavior green', () => {
        const closedTrigger = node('usage', { tagName: 'button', 'data-slot': 'popover-trigger',
            'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
        const openTrigger = node('usage', { tagName: 'button', 'data-slot': 'popover-trigger',
            'aria-haspopup': 'dialog', 'aria-expanded': 'true' });
        const report = extractObservedOverlayContracts(
            node('html', { tagName: 'html' }, [node('body', { tagName: 'body' }, [closedTrigger])]),
            node('html', { tagName: 'html' }, [node('body', { tagName: 'body' }, [
                node('focus-sentinel'), openTrigger, node('usage-content', {
                    'data-slot': 'popover-content', role: 'dialog', 'data-side': 'bottom',
                }),
            ])]),
            [{ targetSourceId: 'html:1/body:1/button:1', event: 'click' }],
            [{ event: 'trigger-toggle', closed: true }],
        );
        expect(report.contracts[0]).toMatchObject({
            kind: 'popover',
            trigger: { ariaHasPopup: 'dialog', ariaExpandedClosed: 'false',
                ariaExpandedOpen: 'true', accessibleName: '' },
            content: { role: 'dialog' },
            gates: { triggerToggleDismissalObserved: true, escapeDismissalObserved: false,
                focusRestorationObserved: false },
        });
    });

    test('fails closed when a portal overlay cannot be related without coordinates or text', () => {
        const trigger = node('trigger', { tagName: 'button' });
        const report = extractObservedOverlayContracts(
            node('root', {}, [trigger]),
            node('root', {}, [structuredClone(trigger), node('dialog', { role: 'dialog' })]),
            [{ targetSourceId: 'trigger', event: 'click' }],
        );
        expect(report.contracts).toEqual([]);
        expect(report.diagnostics).toEqual([expect.objectContaining({
            code: 'overlay-trigger-content-unrelated', targetSourceId: 'trigger',
        })]);
    });

    test('accepts explicit ARIA relationships across different component slot families', () => {
        const trigger = node('trigger', { tagName: 'button', 'aria-controls': 'menu-id' });
        const report = extractObservedOverlayContracts(
            node('root', {}, [trigger]),
            node('root', {}, [structuredClone(trigger), node('menu', {
                id: 'menu-id', role: 'menu', 'data-slot': 'menu-content',
            })]),
            [{ targetSourceId: 'trigger', event: 'click' }],
        );
        expect(report.contracts[0].relationshipEvidence).toBe('aria-controls');
        expect(report.contracts[0].kind).toBe('menu');
    });

    test('extracts pointer-anchored context menus and never invents item actions from labels', () => {
        const trigger = node('session-row', { tagName: 'li', 'data-slot': 'context-menu-trigger' });
        const menu = node('session-menu', { role: 'menu', 'data-slot': 'context-menu-content' }, [
            node('rename-item', { role: 'menuitem', 'data-slot': 'context-menu-item',
                'aria-label': 'Rename' }),
            node('fork-item', { role: 'menuitem', 'data-slot': 'context-menu-item',
                'aria-label': 'Fork', 'data-pulp-action': 'session.fork' }),
        ]);
        const report = extractObservedOverlayContracts(
            node('root', {}, [trigger]),
            node('root', {}, [structuredClone(trigger), menu]),
            [{ targetSourceId: 'session-row', event: 'context-menu' }],
            [{ event: 'escape', closed: true, focusRestored: false }],
        );
        expect(report.diagnostics).toEqual([]);
        expect(report.contracts[0]).toMatchObject({
            kind: 'menu', activationEvent: 'context-menu',
            anchor: { kind: 'pointer', evidence: 'activation-event' },
            relationshipEvidence: 'captured-slot-transition',
            content: { items: [
                { sourceId: 'rename-item', accessibleName: 'Rename', actionBindingId: null },
                { sourceId: 'fork-item', accessibleName: 'Fork', actionBindingId: 'session.fork' },
            ] },
            gates: { escapeDismissalObserved: true, focusRestorationObserved: false },
        });
        const projected = applyObservedOverlayContracts({
            source_node_id: 'root', meta: {}, children: [
                { source_node_id: 'session-row', meta: {}, children: [] },
                { source_node_id: 'session-menu', meta: {}, children: [
                    { source_node_id: 'rename-item', meta: {}, children: [] },
                    { source_node_id: 'fork-item', meta: {}, children: [] },
                ] },
            ],
        }, report.contracts);
        const projectedMenu = projected.children[1];
        expect(projectedMenu.children[0].meta?.action_binding_id).toBeUndefined();
        expect(projectedMenu.children[1].meta?.action_binding_id).toBe('session.fork');
    });

    test('joins trusted activation paths across capture-only ancestors by authored identity', () => {
        const trigger = node('html:1/body:2/div[root]:3/ul[sidebar-menu]:1/li[context-menu-trigger]:1', {
            tagName: 'li', 'data-slot': 'context-menu-trigger',
        });
        const menu = node('html:1/body:2/div[portal]:4/div[context-menu-content]:1', {
            role: 'menu', 'data-slot': 'context-menu-content',
        });
        const report = extractObservedOverlayContracts(
            node('html:1/body:2', {}, [trigger]),
            node('html:1/body:2', {}, [structuredClone(trigger), menu]),
            [{ targetSourceId:
                'html:1/body:1/div[root]:1/ul[sidebar-menu]:1/li[context-menu-trigger]:1',
                event: 'context-menu' }],
        );
        expect(report.diagnostics).toEqual([]);
        expect(report.contracts[0]).toMatchObject({
            triggerNodeSourceId:
                'html:1/body:2/div[root]:3/ul[sidebar-menu]:1/li[context-menu-trigger]:1',
            contentSourceId: 'html:1/body:2/div[portal]:4/div[context-menu-content]:1',
            anchor: { kind: 'pointer' },
        });
    });
});
