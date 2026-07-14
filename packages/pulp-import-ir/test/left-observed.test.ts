import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const values = [0, 10, 10.5, 32.5, 54.5, 68.5, 93, 104.5, 140.5, 204];
const lower = (left: string, position = 'absolute') => lowerObservedDom({
    sourceId: `left-${left}`, tagName: 'div', rect: { x: 0, y: 0, width: 20, height: 20 },
    computedStyle: { display: 'block', position, left }, children: [],
} as ObservedDomNode, 'now');

describe('observed CSS left route', () => {
    it('preserves every observed integer and fractional pixel inset', () => {
        for (const value of values) {
            const ir = lower(`${value}px`);
            expect(ir.layout?.left).toBe(value);
            expect(toNativeDesignIrV1(ir, { sourceFile: '/left', importedAt: 'now' })
                .root.style?.left).toBe(value);
        }
    });
    it('preserves auto as an explicitly unset inset', () => {
        const ir = lower('auto');
        expect(ir.layout?.left).toBe('auto');
        expect(toNativeDesignIrV1(ir, { sourceFile: '/left', importedAt: 'now' }).root.style?.left)
            .toBe('auto');
    });
    it('retains the typed value for static layout while native positioning ignores it', () => {
        expect(lower('10px', 'static').layout?.left).toBe(10);
    });
    it('fails closed unsupported expressions', () => {
        for (const value of ['calc(10px + 1vw)', 'anchor(--item)']) {
            const ir = lower(value);
            expect(ir.layout?.left).toBeUndefined();
            expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
                property: 'left', value, code: 'css-length-unsupported',
            }));
        }
    });
});
