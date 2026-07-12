import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (fontWeight: string) => lowerObservedDom({
    sourceId: `weight-${fontWeight}`, tagName: 'span', text: 'Source weight',
    rect: { x: 0, y: 0, width: 120, height: 24 }, children: [],
    computedStyle: { display: 'block', fontSize: '15px', fontFamily: 'system-ui', fontWeight },
} as ObservedDomNode, 'now');

describe('observed CSS font-weight route', () => {
    it('preserves every observed Palot weight through NativeDesignIR', () => {
        for (const weight of [400, 500, 600]) {
            const ir = lower(String(weight));
            expect(ir.text?.fontWeight).toBe(weight);
            expect(toNativeDesignIrV1(ir, { sourceFile: '/font-weight', importedAt: 'now' })
                .root.style?.fontWeight).toBe(weight);
        }
    });

    it('does not invent a numeric weight from unsupported authored syntax', () => {
        for (const value of ['normal', 'bold', 'bolder', 'calc(400 + 100)']) {
            const ir = lower(value);
            expect(ir.text?.fontWeight).toBeUndefined();
        }
    });
});
