import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed per-side border route', () => {
    it('preserves side-specific CSS Color 4 paint in native style', () => {
        const observed: ObservedDomNode = {
            sourceId: 'side', tagName: 'div', computedStyle: {
                display: 'block', borderBottomWidth: '1px',
                borderBottomColor: 'oklab(0.301182 0.0000137091 0.00000602007 / 0.6)',
            }, rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
        };
        const typed = lowerObservedDom(observed, 'now');
        expect(typed.paint?.borderBottomWidth).toBe(1);
        expect(typed.paint?.borderBottomColor).toBe('#2e2e2e99');
        const native = toNativeDesignIrV1(typed, { sourceFile: '/side', importedAt: 'now' });
        expect(native.root.style?.borderBottomWidth).toBe(1);
        expect(native.root.style?.borderBottomColor).toBe('#2e2e2e99');
    });

    it('preserves an explicit zero bottom width as no-stroke identity', () => {
        const observed: ObservedDomNode = {
            sourceId: 'side-zero', tagName: 'div', computedStyle: {
                display: 'block', borderBottomWidth: '0px', borderBottomColor: 'rgb(46, 46, 46)',
            }, rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
        };
        const typed = lowerObservedDom(observed, 'now');
        expect(typed.paint?.borderBottomWidth).toBe(0);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/side-zero', importedAt: 'now' });
        expect(native.root.style?.borderBottomWidth).toBe(0);
    });
});
