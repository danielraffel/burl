import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(overflowX: string, overflowY: string) {
    const source: ObservedDomNode = {
        sourceId: 'overflow', tagName: 'div', computedStyle: { display: 'flex', overflowX, overflowY },
        rect: { x: 0, y: 0, width: 40, height: 40 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed two-axis CSS overflow', () => {
    it.each(['visible', 'hidden', 'clip', 'auto', 'scroll'])('preserves %s independently', (mode) => {
        const ir = lower(mode, mode === 'visible' ? 'hidden' : 'visible');
        expect(ir.layout?.overflowX).toBe(mode);
        expect(ir.layout?.overflowY).toBe(mode === 'visible' ? 'hidden' : 'visible');
        const native = toNativeDesignIrV1(ir, { sourceFile: '/overflow', importedAt: 'now' });
        expect(native.root.layout).toMatchObject({
            overflowX: mode, overflowY: mode === 'visible' ? 'hidden' : 'visible',
        });
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each(['overlay', 'paint'])('fails closed for unsupported %s', (mode) => {
        const ir = lower(mode, 'visible');
        expect(ir.layout?.overflowX).toBeUndefined();
        expect(ir.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-overflow-unsupported', property: 'overflowX', value: mode }),
        ]));
    });
});
