import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('position bottom route', () => {
    it('preserves negative authored bottom with its position mode', () => {
        for (const position of ['static', 'relative', 'absolute', 'fixed'] as const) {
            const observed: ObservedDomNode = { sourceId: `bottom-${position}`, tagName: 'div',
                computedStyle: { display: 'block', position, bottom: '-2px', width: '20px', height: '10px' },
                rect: { x: 0, y: 0, width: 20, height: 10 }, children: [] };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.layout?.position).toBe(position);
            expect(typed.layout?.bottom).toBe(-2);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/bottom', importedAt: 'now' });
            expect(native.root.style?.position).toBe(position);
            expect(native.root.style?.bottom).toBe(-2);
        }
    });
});
