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
});
