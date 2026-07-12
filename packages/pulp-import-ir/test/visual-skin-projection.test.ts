import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function button(sourceId: string, backgroundColor: string, selected = false): ObservedDomNode {
    return {
        sourceId,
        tagName: 'button',
        text: sourceId,
        attributes: selected ? { 'aria-pressed': 'true' } : {},
        computedStyle: {
            display: 'flex', backgroundColor, color: 'rgb(230, 235, 240)',
            borderColor: 'rgb(61, 72, 84)', borderWidth: '1px', borderRadius: '8px',
            fontFamily: 'system-ui', fontSize: '13px', fontWeight: '600',
            lineHeight: '16px', letterSpacing: '0px', textAlign: 'center',
            paddingLeft: '10px', paddingRight: '10px', paddingTop: '4px', paddingBottom: '4px',
        },
        stateStyles: {
            hover: { backgroundColor: 'rgba(42, 52, 64, 0.8)', color: 'rgb(255, 255, 255)' },
        },
        rect: { x: 0, y: 0, width: 140, height: 32 },
        children: [],
    };
}

describe('observed widget VisualSkin projection', () => {
    it('preserves transparent and opaque captured paint as authoritative state', () => {
        const source: ObservedDomNode = {
            sourceId: 'root', tagName: 'main', computedStyle: { display: 'flex' },
            rect: { x: 0, y: 0, width: 300, height: 40 },
            children: [button('ghost', 'rgba(0, 0, 0, 0)'), button('selected', 'rgb(28, 78, 72)', true)],
        };
        const lowered = lowerObservedDom(source, '2026-07-11T00:00:00Z');
        expect(lowered.children[0].paint?.backgroundColor).toBe('#00000000');
        const native = toNativeDesignIrV1(lowered, { sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z' });
        const children = (native.root.children as Array<Record<string, any>>);
        expect(children[0].visualSkin.states.rest).toMatchObject({
            background: { r: 0, g: 0, b: 0, a: 0 }, foreground: { r: 230, g: 235, b: 240, a: 255 },
            borderWidth: 1, cornerRadius: 8, fontSize: 13, fontWeight: 600,
            lineHeight: 16, letterSpacing: 0, textAlign: 1, insetHorizontal: 10, insetVertical: 4,
        });
        expect(children[0].visualSkin.states.hover.background).toEqual({ r: 42, g: 52, b: 64, a: 204 });
        expect(children[1]).toMatchObject({ type: 'toggle_button' });
        expect(children[1].visualSkin.states.rest.background).toEqual({ r: 28, g: 78, b: 72, a: 255 });
        expect(children[0].style.backgroundColor).toBe('#00000000');
    });
});
