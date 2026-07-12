import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (flexShrink: string) => lowerObservedDom({
    sourceId: flexShrink, tagName: 'div', rect: { x: 0, y: 0, width: 100, height: 20 }, children: [],
    computedStyle: { display: 'flex', flexGrow: '0', flexShrink, flexBasis: 'auto' },
} as ObservedDomNode, 'now');

describe('observed CSS flex-shrink route', () => {
    it('preserves zero and nonnegative finite factors', () => {
        for (const value of ['0', '0.5', '1', '2.75']) {
            const ir = lower(value);
            expect(ir.layout?.flexShrink).toBe(Number(value));
            expect(toNativeDesignIrV1(ir, { sourceFile: '/shrink', importedAt: 'now' }).root.layout?.flexShrink)
                .toBe(Number(value));
        }
    });

    it('fails closed negative and nonfinite factors', () => {
        for (const value of ['-0.1', 'Infinity', 'NaN']) {
            const ir = lower(value);
            expect(ir.layout?.flexShrink).toBeUndefined();
            expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
                property: 'flexShrink', code: 'css-number-unsupported', value,
            }));
        }
    });
});
