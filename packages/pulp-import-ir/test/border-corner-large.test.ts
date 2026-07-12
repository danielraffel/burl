import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('authored large corner radius', () => {
    it('preserves the authored value for paint-time CSS used-value scaling', () => {
        const observed: ObservedDomNode = { sourceId: 'corner', tagName: 'div',
            computedStyle: { display: 'block', borderBottomLeftRadius: '1.67772e+07px', borderBottomRightRadius: '1.67772e+07px' },
            rect: { x: 0, y: 0, width: 100, height: 30 }, children: [] };
        const typed = lowerObservedDom(observed, 'now');
        expect(typed.paint?.borderBottomLeftRadius).toBe(16777200);
        expect(typed.paint?.borderBottomRightRadius).toBe(16777200);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/corner', importedAt: 'now' });
        expect(native.root.style?.borderBottomLeftRadius).toBe(16777200);
        expect(native.root.style?.borderBottomRightRadius).toBe(16777200);
    });
});
