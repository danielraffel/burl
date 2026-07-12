import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (flexBasis: string) => lowerObservedDom({
    sourceId: flexBasis, tagName: 'div', rect: { x: 0, y: 0, width: 80, height: 20 }, children: [],
    computedStyle: { display: 'flex', flexBasis, flexGrow: '1', flexShrink: '1' },
} as ObservedDomNode, 'now');

describe('observed CSS flex-basis route', () => {
    it('preserves percentage, pixel, and auto semantics through NativeDesignIR', () => {
        for (const [source, typed, native] of [
            ['0%', '0%', '0%'], ['0px', 0, '0'], ['37.5%', '37.5%', '37.5%'],
            ['24px', 24, '24'], ['auto', 'auto', 'auto'],
        ] as const) {
            const ir = lower(source);
            expect(ir.layout?.flexBasis).toBe(typed);
            expect(toNativeDesignIrV1(ir, { sourceFile: '/basis', importedAt: 'now' }).root.layout?.flexBasis)
                .toBe(native);
        }
    });

    it('fails closed content and calc rather than replacing them with zero', () => {
        for (const value of ['content', 'calc(50% - 8px)']) {
            const ir = lower(value);
            expect(ir.layout?.flexBasis).toBeUndefined();
            expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
                property: 'flexBasis', code: 'css-length-unsupported', value,
            }));
        }
    });
});
