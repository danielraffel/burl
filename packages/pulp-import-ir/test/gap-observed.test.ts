import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (gap: string) => lowerObservedDom({
    sourceId: `gap-${gap}`, tagName: 'div',
    rect: { x: 0, y: 0, width: 120, height: 80 },
    computedStyle: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap },
    children: [],
} as ObservedDomNode, 'now');

describe('observed CSS gap route', () => {
    it('preserves every observed single pixel gap through NativeDesignIR', () => {
        for (const value of [2, 4, 6, 8, 10, 12, 40]) {
            const ir = lower(`${value}px`);
            expect(ir.layout?.gap).toBe(value);
            expect(toNativeDesignIrV1(ir, { sourceFile: '/gap', importedAt: 'now' })
                .root.layout?.gap).toBe(value);
        }
    });

    it('expands two-axis shorthand in CSS row-column order', () => {
        const ir = lower('2px 6px');
        expect(ir.layout).toMatchObject({ rowGap: 2, columnGap: 6 });
        expect(toNativeDesignIrV1(ir, { sourceFile: '/gap', importedAt: 'now' }).root.layout)
            .toMatchObject({ rowGap: 2, columnGap: 6 });
    });

    it('lowers normal to the zero-gap flex equivalence class', () => {
        const ir = lower('normal');
        expect(ir.layout?.gap).toBeUndefined();
        expect(ir.layout?.rowGap).toBeUndefined();
        expect(ir.layout?.columnGap).toBeUndefined();
        expect(toNativeDesignIrV1(ir, { sourceFile: '/gap', importedAt: 'now' }).root.layout?.gap)
            .toBeUndefined();
    });

    it('fails closed for unsupported expressions and negative authored values', () => {
        for (const value of ['calc(10px + 1vw)', '10%', '-2px', '2px 4px 6px']) {
            const ir = lower(value);
            expect(ir.layout?.gap).toBeUndefined();
            expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
                property: 'gap', code: 'css-length-unsupported', value,
            }));
        }
    });
});
