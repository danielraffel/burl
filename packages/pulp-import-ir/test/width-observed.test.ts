import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(width: string, boxSizing = 'border-box') {
    const source: ObservedDomNode = {
        sourceId: 'width', tagName: 'div', computedStyle: { display: 'flex', width, boxSizing },
        rect: { x: 0, y: 0, width: 10.9922, height: 20 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed CSS width', () => {
    it.each(['10.9922px', '37.5%', 'calc(100% - 64px)', 'auto'])('preserves %s', (width) => {
        const ir = lower(width);
        const expected = width === '10.9922px' ? 10.9922 : width;
        expect(ir.layout?.width).toBe(expected);
        if (ir.meta) (ir.meta as Record<string, unknown>).observed_viewport_fill = false;
        expect(toNativeDesignIrV1(ir, { sourceFile: '/width', importedAt: 'now' }).root.style.width).toBe(expected);
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each(['min-content', 'max-content', 'fit-content(20px)', '-1px'])('fails closed for %s', (width) => {
        const ir = lower(width);
        expect(ir.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-width-unsupported', property: 'width', value: width }),
        ]));
        expect(ir.confidence).toBe('DIVERGE');
    });

    it('distinguishes initial auto sizing from a computed used pixel width', () => {
        const source: ObservedDomNode = {
            sourceId: 'auto-width', tagName: 'h2', text: 'Source title',
            computedStyle: { display: 'block', width: '210.867px', height: '13px' },
            styleProvenance: {}, rect: { x: 0, y: 0, width: 210.867, height: 13 }, children: [],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout?.width).toBe('auto');
        expect(ir.layout?.height).toBe(13);
        const native = toNativeDesignIrV1(ir, { sourceFile: '/auto-width', importedAt: 'now' }).root;
        // Native DesignIR represents CSS auto sizing by omitting a concrete
        // width; emitting the browser's used pixels here would freeze reflow.
        expect(native.style.width).toBeUndefined();
    });

    it('retains the observed used width when source evidence has an authored declaration', () => {
        const source: ObservedDomNode = {
            sourceId: 'authored-width', tagName: 'div', computedStyle: { display: 'block', width: '210.867px' },
            styleProvenance: { width: [{ value: '50%', origin: 'authored' }] },
            rect: { x: 0, y: 0, width: 210.867, height: 13 }, children: [],
        };
        expect(lowerObservedDom(source, 'now').layout?.width).toBe(210.867);
    });
});
