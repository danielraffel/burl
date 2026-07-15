import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(zIndex: string) {
    const observed: ObservedDomNode = {
        sourceId: `z-index-${zIndex}`,
        tagName: 'div',
        computedStyle: { display: 'flex', zIndex },
        rect: { x: 0, y: 0, width: 40, height: 40 },
        children: [],
    };
    return lowerObservedDom(observed, 'now');
}

describe('observed CSS z-index route', () => {
    it.each([
        ['0', 0], ['12', 12], ['-7', -7], ['+4', 4],
        ['2147483647', 2147483647], ['-2147483648', -2147483648],
    ] as const)('preserves integer %s through typed and native IR', (source, expected) => {
        const typed = lower(source);
        expect(typed.layout?.zIndex).toBe(expected);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/z-index', importedAt: 'now' });
        expect(native.root.style?.zIndex).toBe(expected);
        expect(typed.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it('treats auto as the absent initial value', () => {
        const typed = lower('auto');
        expect(typed.layout?.zIndex).toBeUndefined();
        const native = toNativeDesignIrV1(typed, { sourceFile: '/z-index-auto', importedAt: 'now' });
        expect(native.root.style?.zIndex).toBeUndefined();
        expect(typed.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each(['1.5', 'calc(1 + 2)', 'inherit', '2147483648', '-2147483649'])
    ('fails closed for non-integer or out-of-range value %s', (value) => {
        const typed = lower(value);
        expect(typed.layout?.zIndex).toBeUndefined();
        expect(typed.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-number-unsupported', property: 'zIndex', value }),
        ]));
        expect(typed.confidence).toBe('DIVERGE');
    });
});
