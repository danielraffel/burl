import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(style: Record<string, string>) {
    const source: ObservedDomNode = {
        sourceId: 'position', tagName: 'div', computedStyle: { display: 'flex', ...style },
        rect: { x: 0, y: 0, width: 40, height: 20 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed positioned layout', () => {
    it.each(['static', 'relative', 'absolute', 'fixed'] as const)('preserves %s', (position) => {
        const ir = lower({ position, top: '10%', right: 'calc(25% - 4px)', bottom: 'auto', left: '8px' });
        expect(ir.layout).toMatchObject({ position, top: '10%', right: 'calc(25% - 4px)', bottom: 'auto', left: 8 });
        const native = toNativeDesignIrV1(ir, { sourceFile: '/position', importedAt: 'now' });
        expect(native.root.style).toMatchObject({ position, top: '10%', right: 'calc(25% - 4px)', left: 8 });
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each(['sticky', 'anchor'])('fails closed for %s', (position) => {
        const ir = lower({ position });
        expect(ir.layout?.position).toBeUndefined();
        expect(ir.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-position-unsupported', property: 'position', value: position }),
        ]));
    });
});
