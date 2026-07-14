import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toJSXLikeTree, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const fixture: ObservedDomNode = {
    sourceId: 'root',
    tagName: 'main',
    computedStyle: {
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgb(20, 20, 20)',
    },
    rect: { x: 0, y: 0, width: 1200, height: 800 },
    children: [
        {
            sourceId: 'new-session',
            tagName: 'button',
            text: 'New Session',
            computedStyle: {
                display: 'flex',
                fontFamily: 'Inter',
                fontSize: '13px',
                fontWeight: '500',
                color: 'rgb(255, 255, 255)',
                borderRadius: '10.5px',
            },
            rect: { x: 8, y: 54, width: 264, height: 32 },
            children: [],
        },
        {
            sourceId: 'composer',
            tagName: 'textarea',
            attributes: {
                'aria-label': 'Message composer',
                'data-pulp-semantic-id': 'chat.composer',
                'data-pulp-action': 'chat.send',
            },
            computedStyle: { display: 'block', fontSize: '14px' },
            rect: { x: 297, y: 636.5, width: 873, height: 64 },
            children: [],
        },
    ],
};

describe('observed DOM adapter', () => {
    it('preserves captured fixed grid track line budgets for direct text cells', () => {
        const cell = (sourceId: string, text: string, y: number): ObservedDomNode => ({
            sourceId, tagName: 'span', text, attributes: {},
            computedStyle: { display: 'block', whiteSpace: 'normal', lineHeight: '18px' },
            rect: { x: 0, y, width: 120, height: 18 }, children: [],
        });
        const grid: ObservedDomNode = {
            sourceId: 'summary-grid', tagName: 'div', attributes: {},
            computedStyle: { display: 'grid' },
            rect: { x: 0, y: 0, width: 220, height: 36 },
            children: [cell('average-cost', 'Avg cost / exchange', 0),
                cell('average-time', 'Avg time / exchange', 18)],
        };
        const ir = lowerObservedDom(grid, 'now');
        expect(ir.children.map((child) => child.text?.numberOfLines)).toEqual([1, 1]);

        const flex = { ...grid, sourceId: 'summary-flex',
            computedStyle: { display: 'flex', flexDirection: 'column' },
            children: [cell('flex-cost', 'Avg cost / exchange', 0)] } satisfies ObservedDomNode;
        expect(lowerObservedDom(flex, 'now').children[0].text?.numberOfLines).toBeUndefined();
    });
    it('keeps content-sized single-line text intrinsic without multi-viewport evidence', () => {
        const source: ObservedDomNode = {
            sourceId: 'intrinsic-label', tagName: 'span', attributes: {},
            computedStyle: {
                display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                width: '54.4375px', paddingLeft: '0px', paddingRight: '0px',
                borderLeftWidth: '0px', borderRightWidth: '0px',
            },
            rect: { x: 40, y: 101, width: 54.4375, height: 22 }, children: [],
            content: [{ kind: 'text', text: 'General',
                rect: { x: 40, y: 103, width: 54.4375, height: 17.5 } }],
        };
        const root: ObservedDomNode = {
            sourceId: 'row', tagName: 'div',
            computedStyle: { display: 'flex', flexDirection: 'row' },
            rect: { x: 0, y: 0, width: 200, height: 32 }, children: [source],
        };
        const ir = lowerObservedDom(root, 'now');
        expect(ir.children[0].layout).toMatchObject({ width: 'auto', minWidth: 'auto' });
        const native = toNativeDesignIrV1(ir, { sourceFile: '/fixture', importedAt: 'now' });
        expect(native.root.children[0].layout.widthMode).toBeUndefined();
        expect(native.root.children[0].layout.width).toBeUndefined();
    });
    it('retains a genuinely constrained single-line text width', () => {
        const source: ObservedDomNode = {
            sourceId: 'constrained-label', tagName: 'span', attributes: {},
            computedStyle: {
                display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', width: '54px',
            },
            rect: { x: 40, y: 101, width: 54, height: 22 }, children: [],
            content: [{ kind: 'text', text: 'A longer label',
                rect: { x: 40, y: 103, width: 90, height: 17.5 } }],
        };
        expect(lowerObservedDom(source, 'now').layout?.width).toBe(54);
    });
    it('keeps shrink-to-fit column content intrinsic and its browser-stretched children flexible', () => {
        const description: ObservedDomNode = {
            sourceId: 'description', tagName: 'span', attributes: {},
            computedStyle: { display: 'block', width: '268.359px' },
            rect: { x: 453, y: 165, width: 268.359, height: 22 }, children: [],
            content: [{ kind: 'text', text: 'Where files and folders open by default',
                rect: { x: 453, y: 167, width: 268.359, height: 17.5 } }],
        };
        const source: ObservedDomNode = {
            sourceId: 'label-group', tagName: 'div', attributes: {},
            computedStyle: { display: 'flex', flexDirection: 'column', alignItems: 'normal',
                width: '268.359px', flexGrow: '0' },
            rect: { x: 453, y: 143, width: 268.359, height: 46 }, children: [description],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout).toMatchObject({ width: 'auto', minWidth: 'auto' });
        expect(ir.children[0].layout).toMatchObject({ alignSelf: 'stretch' });
        expect(ir.children[0].layout?.width).toBeUndefined();
    });
    it('retains authored cross-axis widths outside intrinsic column groups', () => {
        const source: ObservedDomNode = {
            sourceId: 'fixed-group', tagName: 'div', attributes: {},
            computedStyle: { display: 'flex', flexDirection: 'column', width: '200px' },
            styleProvenanceWinners: { width: '200px' },
            rect: { x: 0, y: 0, width: 200, height: 30 },
            children: [{
                sourceId: 'fixed-description', tagName: 'span', attributes: {},
                computedStyle: { display: 'block', width: '200px' },
                rect: { x: 0, y: 0, width: 200, height: 20 }, children: [],
                content: [{ kind: 'text', text: 'Short text', rect: { x: 0, y: 0, width: 60, height: 18 } }],
            }],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout?.width).toBe(200);
        expect(ir.children[0].layout?.width).toBe(200);
        expect(ir.children[0].layout?.alignSelf).toBeUndefined();
    });
    it('preserves captured direct text in block leaf nodes through native DesignIR', () => {
        const source: ObservedDomNode = {
            sourceId: 'label', tagName: 'div', attributes: {},
            computedStyle: { display: 'block', color: 'rgb(240, 240, 240)', fontSize: '13px' },
            rect: { x: 8, y: 8, width: 120, height: 20 }, children: [],
            content: [{ kind: 'text', text: 'New Session' }],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(source, 'now'), { sourceFile: '/fixture', importedAt: 'now' });
        expect(native.root).toMatchObject({ type: 'text', content: 'New Session' });
    });
    it('preserves direct text in semantic list leaves', () => {
        const source: ObservedDomNode = {
            sourceId: 'step', tagName: 'li', attributes: {},
            computedStyle: { display: 'list-item', color: 'rgb(240, 240, 240)', fontSize: '13px' },
            rect: { x: 8, y: 8, width: 120, height: 20 }, children: [],
            content: [{ kind: 'text', text: 'Apply theme' }],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(source, 'now'), { sourceFile: '/fixture', importedAt: 'now' });
        expect(native.root).toMatchObject({ type: 'text', content: 'Apply theme' });
    });
    it('preserves ordered direct and emphasized text in list items', () => {
        const strong: ObservedDomNode = {
            sourceId: 'emphasis', tagName: 'strong', attributes: {},
            computedStyle: { display: 'inline', fontWeight: '700' },
            rect: { x: 48, y: 8, width: 44, height: 20 }, children: [],
            content: [{ kind: 'text', text: 'theme' }],
        };
        const source: ObservedDomNode = {
            sourceId: 'step', tagName: 'li', attributes: {},
            computedStyle: { display: 'list-item', fontSize: '13px' },
            rect: { x: 8, y: 8, width: 120, height: 20 }, children: [strong],
            content: [{ kind: 'text', text: 'Apply ' }, { kind: 'child', sourceId: 'emphasis' }],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(source, 'now'), { sourceFile: '/fixture', importedAt: 'now' });
        expect(native.root).toMatchObject({ type: 'text', content: 'Apply theme' });
    });
    it('lowers stable source IDs, geometry, paint, text, and native controls', () => {
        const ir = lowerObservedDom(fixture, '2026-07-11T20:00:00.000Z');
        expect(ir.stable_anchor_id).toBe('observed-dom:root');
        expect(ir.paint?.backgroundColor).toBe('#141414ff');
        expect(ir.children[0].tag).toBe('Button');
        expect(ir.children[0].stable_anchor_id).toBe('observed-dom:new-session');
        expect(ir.children[0].text?.text).toBe('New Session');
        expect(ir.children[0].paint?.borderRadius).toBe(10.5);
        expect(ir.children[1].tag).toBe('TextEditor');
        expect(ir.children[1].meta?.semantic_id).toBe('chat.composer');
        expect(ir.children[1].confidence).toBe('PASS');
        expect(ir.children[1].layout).toMatchObject({ display: 'flex', flexDirection: 'column' });
    });

    it('feeds the existing prop-applier tree without a second renderer', () => {
        const jsx = toJSXLikeTree(lowerObservedDom(fixture, '2026-07-11T20:00:00.000Z'));
        expect(jsx.children[0].props.key).toBe('observed-dom:new-session');
        expect(jsx.children[0].props.width).toBe(264);
        expect(jsx.children[0].props.text).toBe('New Session');
        expect(jsx.children[1].props.accessibilityLabel).toBe('Message composer');
        expect(jsx.children[1].props['data-pulp-action']).toBe('chat.send');
    });

    it('rejects duplicate source identities', () => {
        const duplicate = structuredClone(fixture);
        duplicate.children[1].sourceId = 'new-session';
        expect(() => lowerObservedDom(duplicate, '2026-07-11T20:00:00.000Z')).toThrow(/unique/);
    });

    it('normalizes CSS Color 4 paint and fails closed on unresolved values', () => {
        const source = structuredClone(fixture);
        source.computedStyle.backgroundColor = 'oklch(50% 0.1 120 / 80%)';
        source.computedStyle.color = 'currentColor';

        const ir = lowerObservedDom(source, '2026-07-11T20:00:00.000Z');
        expect(ir.paint?.backgroundColor).toMatch(/^#[0-9a-f]{8}$/);
        expect(ir.confidence).toBe('DIVERGE');
        expect(ir.meta?.css_color_diagnostics).toEqual([
            { property: 'color', value: 'currentColor', code: 'css-color-unsupported' },
        ]);
        expect(ir.raw_source).toMatchObject({
            computedStyle: { color: 'currentColor' },
        });
    });

    it('preserves manifest-owned actions and explicit selected-state policy', () => {
        const source: ObservedDomNode = {
            sourceId: 'choice-row',
            tagName: 'button',
            attributes: {
                'data-pulp-semantic-id': 'fixture.choice',
                'data-pulp-action': 'fixture.activate',
                'data-pulp-action-required': 'true',
                'data-pulp-event': 'click',
                'data-pulp-payload-contract': 'fixture.payload',
                'data-active': '',
                tabindex: '0',
            },
            computedStyle: { display: 'flex' },
            rect: { x: 0, y: 0, width: 160, height: 32 },
            children: [],
            text: 'Neutral choice',
        };
        const ir = lowerObservedDom(source, 'now', {
            applicationActions: ['fixture.activate'],
            selectedStateAttributes: ['data-active'],
        });
        expect(ir.tag).toBe('ToggleButton');
        expect(ir.interaction).toMatchObject({
            actionBindingId: 'fixture.activate', selected: true, tabIndex: 0,
            payloadContract: 'fixture.payload',
        });
        const native = toNativeDesignIrV1(ir, { sourceFile: '/fixture', importedAt: 'now' });
        expect(native.root.attributes).toMatchObject({
            semantic_id: 'fixture.choice',
            action_binding_id: 'fixture.activate',
            pulpRouteId: 'fixture.choice',
            pulpHostAction: 'fixture.activate',
            pulpEventContract: 'click',
            pulpPayloadContract: 'fixture.payload',
            selected: 'true',
            focusable: 'true',
            tabIndex: '0',
        });
        expect(() => lowerObservedDom(source, 'now', {
            applicationActions: [], selectedStateAttributes: ['data-active'],
        })).toThrow(/unknown application action/);
        const withoutPolicy = structuredClone(source);
        delete withoutPolicy.attributes?.['data-pulp-action'];
        delete withoutPolicy.attributes?.['data-pulp-action-required'];
        expect(lowerObservedDom(withoutPolicy, 'now').tag).toBe('Button');
    });

    it('keeps source-owned SVG children in promoted composite buttons', () => {
        const source: ObservedDomNode = {
            sourceId: 'composite-button',
            tagName: 'button',
            computedStyle: { display: 'flex' },
            rect: { x: 0, y: 0, width: 140, height: 32 },
            attributes: { 'aria-label': 'Neutral composite' },
            content: [
                { kind: 'child', sourceId: 'icon' },
                { kind: 'text', text: ' Process', rect: { x: 32, y: 4, width: 48, height: 24 } },
                { kind: 'child', sourceId: 'status' },
            ],
            children: [
                {
                    sourceId: 'icon', tagName: 'svg', computedStyle: { display: 'block' },
                    rect: { x: 4, y: 4, width: 24, height: 24 }, children: [],
                },
                {
                    sourceId: 'status', tagName: 'span', content: [{ kind: 'text', text: ' ready' }],
                    computedStyle: { display: 'inline' }, rect: { x: 80, y: 4, width: 40, height: 24 }, children: [],
                },
            ],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.tag).toBe('Button');
        expect(ir.text?.text).toBe('');
        expect(ir.children).toHaveLength(3);
        expect(ir.children[0]).toMatchObject({ tag: 'Icon', source_node_id: 'icon' });
        expect(ir.children[1]).toMatchObject({ tag: 'Label', text: { text: 'Process' } });
        expect(ir.children[2]).toMatchObject({ tag: 'Label', source_node_id: 'status', text: { text: ' ready' } });
    });
});
