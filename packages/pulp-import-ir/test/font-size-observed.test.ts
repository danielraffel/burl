import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (fontSize: string) => lowerObservedDom({
    sourceId: `font-${fontSize}`, tagName: 'span', text: 'Source faithful',
    rect: { x: 0, y: 0, width: 120, height: 24 }, children: [],
    computedStyle: { display: 'block', fontSize, fontFamily: 'system-ui', fontWeight: '500' },
} as ObservedDomNode, 'now');

describe('observed CSS font-size route', () => {
    it('preserves every observed Palot size and fractional pixels through NativeDesignIR', () => {
        for (const size of [10, 11, 13, 13.5, 15, 16]) {
            const ir = lower(`${size}px`);
            expect(ir.text?.fontSize).toBe(size);
            expect(toNativeDesignIrV1(ir, { sourceFile: '/font-size', importedAt: 'now' })
                .root.style?.fontSize).toBe(size);
        }
    });

    it('does not invent a size for non-pixel or malformed input', () => {
        for (const value of ['1rem', '80%', 'calc(12px + 1vw)', 'large', 'NaNpx']) {
            const ir = lower(value);
            expect(ir.text?.fontSize).toBeUndefined();
            expect(toNativeDesignIrV1(ir, { sourceFile: '/font-size', importedAt: 'now' })
                .root.style?.fontSize).toBeUndefined();
        }
    });
});
