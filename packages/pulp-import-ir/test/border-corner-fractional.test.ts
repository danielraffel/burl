import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('fractional per-corner radius route', () => {
    it('preserves every observed authored pixel value', () => {
        for (const value of [10.5, 10, 12.5, 16.5, 4, 7.5, 8.5]) {
            const observed: ObservedDomNode = { sourceId: `corner-${value}`, tagName: 'div',
                computedStyle: { display: 'block', borderTopLeftRadius: `${value}px`, borderTopRightRadius: `${value}px`, borderBottomLeftRadius: `${value}px`, borderBottomRightRadius: `${value}px` },
                rect: { x: 0, y: 0, width: 100, height: 40 }, children: [] };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.paint?.borderBottomLeftRadius).toBe(value);
            expect(typed.paint?.borderBottomRightRadius).toBe(value);
            expect(typed.paint?.borderTopLeftRadius).toBe(value);
            expect(typed.paint?.borderTopRightRadius).toBe(value);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/corner', importedAt: 'now' });
            expect(native.root.style?.borderBottomLeftRadius).toBe(value);
            expect(native.root.style?.borderBottomRightRadius).toBe(value);
            expect(native.root.style?.borderTopLeftRadius).toBe(value);
            expect(native.root.style?.borderTopRightRadius).toBe(value);
        }
    });
});
