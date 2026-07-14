import { describe, expect, test } from 'vitest';
import type { IRNode } from '../src/types.js';
import { unionApplicationStateTrees } from '../src/application-state-variants.js';

const node = (id: string, children: IRNode[] = []): IRNode => ({
    type: 'frame', name: id, source_node_id: id, stable_anchor_id: id,
    source: { format: 'observed-dom', file: 'capture', node: id, captured_at: 'now' },
    layout: {}, paint: {}, text_style: {}, interaction: {}, confidence: 'pass',
    children,
});

describe('application state structural union', () => {
    test('pre-mounts alternate branches with complete state visibility maps', () => {
        const closed = node('root', [node('trigger')]);
        const open = node('root', [node('trigger'), node('popover', [node('menu-item')])]);
        const merged = unionApplicationStateTrees('menu.presentation', [
            { state: 'closed', root: closed }, { state: 'open', root: open },
        ]);
        expect(merged.children.map((child) => child.source_node_id)).toEqual(['trigger', 'popover']);
        expect(merged.children[1].responsive).toMatchObject({
            applicationStateKey: 'menu.presentation',
            visibilityByApplicationState: { closed: false, open: true },
        });
        expect(merged.children[1].children[0].responsive).toMatchObject({
            visibilityByApplicationState: { closed: false, open: true },
        });
    });

    test('rejects reparenting and pre-mounts render-property variants', () => {
        expect(() => unionApplicationStateTrees('route', [
            { state: 'a', root: node('root', [node('left', [node('shared')]), node('right')]) },
            { state: 'b', root: node('root', [node('left'), node('right', [node('shared')])]) },
        ])).toThrow('changes parent');
        const first = node('root', [node('shared')]);
        const second = node('root', [node('shared')]);
        second.children[0].paint.backgroundColor = '#ff0000';
        const merged = unionApplicationStateTrees('mode', [
            { state: 'a', root: first }, { state: 'b', root: second },
        ]);
        expect(merged.children).toHaveLength(2);
        expect(merged.children.map((child) => child.paint.backgroundColor)).toEqual([undefined, '#ff0000']);
        expect(merged.children[1].responsive?.visibilityByApplicationState).toEqual({ a: false, b: true });
        expect(merged.children[1].source_node_id).toBe('shared');
        expect(merged.children[1].stable_anchor_id).toContain('application-state:b');
        expect(merged.children[1].stable_anchor_id?.endsWith('shared')).toBe(true);
    });
    test('requires explicit ownership for state-only portal overlays', () => {
        const closed = node('root', [node('overlay-host')]);
        const open = node('root', [node('overlay-host', [node('menu')])]);
        open.children[0].children[0].layout.position = 'fixed';
        expect(() => unionApplicationStateTrees('menu', [
            { state: 'closed', root: closed }, { state: 'open', root: open },
        ])).toThrow('no declared overlay host');
        expect(unionApplicationStateTrees('menu', [
            { state: 'closed', root: closed }, { state: 'open', root: open },
        ], { overlayHostIds: ['overlay-host'] }).children[0].children[0].source_node_id).toBe('menu');

		const nestedOpen = node('root', [node('overlay-host', [node('popover', [node('arrow')])])]);
		nestedOpen.children[0].children[0].children[0].layout.position = 'absolute';
		expect(unionApplicationStateTrees('menu', [
			{ state: 'closed', root: node('root', [node('overlay-host')]) },
			{ state: 'open', root: nestedOpen },
		], { overlayHostIds: ['overlay-host'] }).children[0].children[0].children[0].source_node_id).toBe('arrow');
    });

    test('does not conflate reused generated portal IDs with different semantic subtrees', () => {
        const generated = (slot: string): IRNode => {
            const child = node(`dom/body/div-id-_r_5d_:0/div-${slot}:0`);
            (child as any).raw_source = { node: { attributes: { 'data-slot': slot } } };
            const portal = node('dom/body/div-id-_r_5d_:0', [child]);
            (portal as any).raw_source = { node: { attributes: { 'data-base-ui-portal': '' } } };
            return portal;
        };
        const first = node('root', [generated('select-content')]);
        const second = node('root', [generated('searchable-list-popover-content')]);
        const merged = unionApplicationStateTrees('overlay.kind', [
            { state: 'select', root: first }, { state: 'search', root: second },
        ], { overlayHostIds: ['dom/body/div-id-_r_5d_:0'] });
        expect(merged.children).toHaveLength(2);
        expect(merged.children.map((child) => child.children[0]!.source_node_id)).toEqual([
            'dom/body/div-id-_r_5d_:0/div-select-content:0',
            'dom/body/div-id-_r_5d_:0/div-searchable-list-popover-content:0',
        ]);
    });

    test('uses typed text content to distinguish otherwise-identical generated portal siblings', () => {
        const generated = (label: string): IRNode => {
            const text = node('dom/body/div-id-_r_5d_:0/div-tooltip:0/label:0');
            text.text = { text: label };
            const tooltip = node('dom/body/div-id-_r_5d_:0/div-tooltip:0', [text]);
            (tooltip as any).raw_source = { node: { attributes: { 'data-slot': 'tooltip-content' } } };
            const portal = node('dom/body/div-id-_r_5d_:0', [tooltip]);
            (portal as any).raw_source = { node: { attributes: { 'data-base-ui-portal': '' } } };
            return portal;
        };
        const captured = node('root', [generated('Search projects'), generated('Add project')]);
        const result = unionApplicationStateTrees('tooltip.open', [
            { state: 'closed', root: captured },
            { state: 'open', root: structuredClone(captured) },
        ]);
        expect(result.children).toHaveLength(2);
    });

    test('rebases Base UI selector-path instance ordinals across atomic captures', () => {
        const closedChild = node('html/body/button[base-ui-_r_6_]:1/div/span:2');
        closedChild.layout.position = 'absolute';
        const openChild = node('html/body/button[base-ui-_r_6_]:2/div/span:2');
        openChild.layout.position = 'absolute';
        const merged = unionApplicationStateTrees('server.menu.open', [
            { state: 'closed', root: node('root', [closedChild]) },
            { state: 'open', root: node('root', [openChild]) },
        ]);
        expect(merged.children).toHaveLength(1);
        expect(merged.children[0]!.responsive).toBeUndefined();
    });
});
