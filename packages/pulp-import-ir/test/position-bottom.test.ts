import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('position bottom route', () => {
    it('preserves negative authored bottom with its position mode', () => {
        for (const value of [-2, 0, 10.5, 118, 161, 764, 801]) {
          for (const position of ['static', 'relative', 'absolute', 'fixed'] as const) {
            const observed: ObservedDomNode = { sourceId: `bottom-${position}-${value}`, tagName: 'div',
                computedStyle: { display: 'block', position, bottom: `${value}px`, width: '20px', height: '10px' },
                rect: { x: 0, y: 0, width: 20, height: 10 }, children: [] };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.layout?.position).toBe(position);
            expect(typed.layout?.bottom).toBe(value);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/bottom', importedAt: 'now' });
            expect(native.root.style?.position).toBe(position);
            expect(native.root.style?.bottom).toBe(value);
          }
        }
    });
});
