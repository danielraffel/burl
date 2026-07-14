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

    it('preserves supported linear calc and fails closed for content sizing', () => {
        const calc = lower('calc(50% - 8px)');
        expect(calc.layout?.flexBasis).toBe('calc(50% - 8px)');
        expect(calc.meta?.observed_style_diagnostics).toBeUndefined();

        const content = lower('content');
        expect(content.layout?.flexBasis).toBeUndefined();
        expect(content.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
            property: 'flexBasis', code: 'css-length-unsupported', value: 'content',
        }));
    });
});
