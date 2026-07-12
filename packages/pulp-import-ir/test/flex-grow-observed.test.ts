import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (flexGrow: string) => lowerObservedDom({
    sourceId: flexGrow, tagName: 'div', rect: { x: 0, y: 0, width: 40, height: 20 }, children: [],
    computedStyle: { display: 'flex', flexGrow, flexShrink: '1', flexBasis: '0%' },
} as ObservedDomNode, 'now');

describe('observed CSS flex-grow route', () => {
    it('preserves zero and nonnegative finite weights', () => {
        for (const value of ['0', '0.5', '1', '3.25']) {
            const ir = lower(value);
            expect(ir.layout?.flexGrow).toBe(Number(value));
            expect(toNativeDesignIrV1(ir, { sourceFile: '/grow', importedAt: 'now' }).root.layout?.flexGrow)
                .toBe(Number(value));
        }
    });

    it('fails closed negative and nonfinite values', () => {
        for (const value of ['-1', 'Infinity', 'NaN']) {
            const ir = lower(value);
            expect(ir.layout?.flexGrow).toBeUndefined();
            expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
                property: 'flexGrow', code: 'css-number-unsupported', value,
            }));
        }
    });
});
