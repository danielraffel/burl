import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('per-corner zero radius identity', () => {
    it('preserves bottom-left zero through native style', () => {
        const observed: ObservedDomNode = { sourceId: 'corner', tagName: 'div',
            computedStyle: { display: 'block', borderBottomLeftRadius: '0px' },
            rect: { x: 0, y: 0, width: 100, height: 30 }, children: [] };
        const typed = lowerObservedDom(observed, 'now');
        expect(typed.paint?.borderBottomLeftRadius).toBe(0);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/corner', importedAt: 'now' });
        expect(native.root.style?.borderBottomLeftRadius).toBe(0);
    });
});
