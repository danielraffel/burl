import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(value: string) {
    const observed: ObservedDomNode = { sourceId: `radius-${value}`, tagName: 'div',
        computedStyle: { display: 'block', borderRadius: value },
        rect: { x: 0, y: 0, width: 100, height: 30 }, children: [] };
    const typed = lowerObservedDom(observed, 'now');
    return { typed, native: toNativeDesignIrV1(typed, { sourceFile: '/radius', importedAt: 'now' }) };
}

describe('border-radius shorthand route', () => {
    it('preserves uniform authored radii for paint-time scaling', () => {
        for (const value of [0, 16777200, 10.5, 10, 12.5, 16.5, 4, 7.5, 8.5]) {
            const { typed, native } = lower(`${value}px`);
            expect(typed.paint?.borderRadius).toBe(value);
            expect(native.root.style?.borderRadius).toBe(value);
        }
    });

    it('expands four-value shorthand in CSS corner order', () => {
        const { typed, native } = lower('0px 10.5px 10.5px 0px');
        expect(typed.paint).toMatchObject({ borderTopLeftRadius: 0, borderTopRightRadius: 10.5,
            borderBottomRightRadius: 10.5, borderBottomLeftRadius: 0 });
        expect(native.root.style).toMatchObject({ borderTopLeftRadius: 0, borderTopRightRadius: 10.5,
            borderBottomRightRadius: 10.5, borderBottomLeftRadius: 0 });
    });
});
