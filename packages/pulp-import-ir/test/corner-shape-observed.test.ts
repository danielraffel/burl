import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(cornerShape: string) {
    const observed: ObservedDomNode = {
        sourceId: `corner-${cornerShape}`, tagName: 'div',
        computedStyle: { display: 'block', borderRadius: '12.5px', cornerShape },
        rect: { x: 0, y: 0, width: 100, height: 40 }, children: [],
    };
    const typed = lowerObservedDom(observed, 'now');
    return { typed, native: toNativeDesignIrV1(typed, { sourceFile: '/corner-shape', importedAt: 'now' }) };
}

describe('corner-shape observed route', () => {
    it('maps portable round and supported continuous corners into native style', () => {
        for (const [source, expected] of [
            ['round', 'circular'], ['squircle', 'continuous'],
            ['superellipse(1)', 'continuous'], ['superellipse(1.5)', 'continuous'],
        ] as const) {
            const { typed, native } = lower(source);
            expect(typed.paint?.borderCurve).toBe(expected);
            expect(native.root.style?.borderCurve).toBe(expected);
        }
    });

    it('fails closed for corner shapes without a native equivalent', () => {
        const { typed, native } = lower('bevel');
        expect(typed.paint?.borderCurve).toBeUndefined();
        expect(native.root.style?.borderCurve).toBeUndefined();
        expect(typed.meta?.observed_style_diagnostics).toContainEqual({
            property: 'cornerShape', value: 'bevel', code: 'css-corner-shape-unsupported',
        });
    });
});
