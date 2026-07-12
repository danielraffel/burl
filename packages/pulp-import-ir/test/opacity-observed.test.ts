import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(opacity: string) {
    const source: ObservedDomNode = {
        sourceId: 'opacity', tagName: 'div', computedStyle: { display: 'flex', opacity },
        rect: { x: 0, y: 0, width: 32, height: 32 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed CSS opacity', () => {
    it.each([['0', 0], ['0.25', 0.25]])('preserves %s including exact zero', (source, expected) => {
        const ir = lower(source);
        expect(ir.paint?.opacity).toBe(expected);
        expect(toNativeDesignIrV1(ir, { sourceFile: '/opacity', importedAt: 'now' }).root.style.opacity)
            .toBe(expected);
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it('treats one as the exact native default', () => {
        const ir = lower('1');
        expect(ir.paint?.opacity).toBeUndefined();
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each(['-0.1', '1.1', 'not-a-number'])('fails closed for %s', (source) => {
        expect(lower(source).meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-opacity-unsupported', property: 'opacity', value: source }),
        ]));
    });
});
