import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('background-image none identity', () => {
    it('preserves an explicit empty ordered layer list', () => {
        const observed: ObservedDomNode = {
            sourceId: 'none', tagName: 'div',
            computedStyle: { display: 'block', backgroundImage: 'none' },
            rect: { x: 0, y: 0, width: 10, height: 10 }, children: [],
        };
        const typed = lowerObservedDom(observed, 'now');
        expect(typed.paint?.backgroundLayers).toEqual([]);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/none', importedAt: 'now' });
        expect(native.root.style?.backgroundLayers).toEqual([]);
    });
});
