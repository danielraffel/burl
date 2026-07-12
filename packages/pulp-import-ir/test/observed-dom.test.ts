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
                { kind: 'text', text: ' Process' },
                { kind: 'child', sourceId: 'status' },
            ],
            children: [
                {
                    sourceId: 'icon', tagName: 'svg', computedStyle: { display: 'block' },
                    rect: { x: 4, y: 4, width: 24, height: 24 }, children: [],
                },
                {
                    sourceId: 'status', tagName: 'span', text: ' ready',
                    computedStyle: { display: 'inline' }, rect: { x: 80, y: 4, width: 40, height: 24 }, children: [],
                },
            ],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.tag).toBe('Button');
        expect(ir.text?.text).toBe(' Process ready');
        expect(ir.children).toHaveLength(1);
        expect(ir.children[0]).toMatchObject({ tag: 'Icon', source_node_id: 'icon' });
    });
});
