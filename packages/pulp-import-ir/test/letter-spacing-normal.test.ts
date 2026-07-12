import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (letterSpacing: string) => lowerObservedDom({
    sourceId: 'tracking', tagName: 'span', text: 'Tracked',
    rect: { x: 0, y: 0, width: 80, height: 20 }, children: [],
    computedStyle: { display: 'inline', fontSize: '14px', letterSpacing },
} as ObservedDomNode, 'now');

describe('observed letter-spacing normal', () => {
    it('preserves normal as explicit zero through NativeDesignIR', () => {
        const ir = lower('normal');
        expect(ir.text?.letterSpacing).toBe(0);
        expect(toNativeDesignIrV1(ir, { sourceFile: '/tracking', importedAt: 'now' })
            .root.style?.letterSpacing).toBe(0);
    });
    it('keeps explicit 0px identical but authored', () => {
        expect(lower('0px').text?.letterSpacing).toBe(0);
    });
    it('fails closed invalid units and keywords', () => {
        for (const value of ['0.1em', 'wide', 'calc(1px + 1vw)']) {
            const ir = lower(value);
            expect(ir.text?.letterSpacing).toBeUndefined();
            expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
                property: 'letterSpacing', value, code: 'css-length-unsupported',
            }));
        }
    });
});
