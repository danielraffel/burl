import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (flexWrap: string) => lowerObservedDom({
    sourceId: flexWrap, tagName: 'div', rect: { x: 0, y: 0, width: 120, height: 80 }, children: [],
    computedStyle: { display: 'flex', flexDirection: 'row', flexWrap },
} as ObservedDomNode, 'now');

describe('observed CSS flex-wrap route', () => {
    it('preserves nowrap wrap and wrap-reverse through NativeDesignIR', () => {
        const expected = {
            nowrap: { wrap: false },
            wrap: { wrap: true },
            'wrap-reverse': { wrap: true, wrapReverse: true },
        } as const;
        for (const value of ['nowrap', 'wrap', 'wrap-reverse'] as const) {
            const ir = lower(value);
            expect(ir.layout?.flexWrap).toBe(value);
            const layout = toNativeDesignIrV1(ir, { sourceFile: '/wrap', importedAt: 'now' }).root.layout;
            expect(layout).toEqual(expect.objectContaining(expected[value]));
        }
    });
});
