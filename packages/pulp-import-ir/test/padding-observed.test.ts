import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(style: Record<string, string>) {
    const source: ObservedDomNode = {
        sourceId: 'padding', tagName: 'div', computedStyle: { display: 'flex', ...style },
        rect: { x: 0, y: 0, width: 200, height: 100 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed CSS padding family', () => {
    it.each([
        ['0px', [0, 0, 0, 0]],
        ['2px 4px', [2, 4, 2, 4]],
        ['2px 4px 6px', [2, 4, 6, 4]],
        ['2px 4px 6px 8px', [2, 4, 6, 8]],
    ] as const)('expands shorthand %s', (padding, expected) => {
        const ir = lower({ padding });
        expect([ir.layout?.paddingTop, ir.layout?.paddingRight, ir.layout?.paddingBottom, ir.layout?.paddingLeft])
            .toEqual(expected);
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it('preserves percent/calc, side precedence, and box sizing', () => {
        const ir = lower({
            padding: '5% calc(10% - 4px)', paddingLeft: '12px', boxSizing: 'content-box',
        });
        expect(ir.layout).toMatchObject({
            paddingTop: '5%', paddingRight: 'calc(10% - 4px)',
            paddingBottom: '5%', paddingLeft: 12, boxSizing: 'content-box',
        });
        const native = toNativeDesignIrV1(ir, { sourceFile: '/padding', importedAt: 'now' });
        expect(native.root.layout).toMatchObject({
            paddingTop: '5%', paddingRight: 'calc(10% - 4px)',
            paddingBottom: '5%', paddingLeft: 12, boxSizing: 'content-box',
        });
    });

    it.each([{ padding: '-1px' }, { padding: 'auto' }, { paddingLeft: 'bogus' }, { boxSizing: 'padding-box' }])
        ('fails closed for $padding$paddingLeft$boxSizing', (style) => {
            const ir = lower(style);
            expect(ir.meta?.observed_style_diagnostics?.length).toBeGreaterThan(0);
            expect(ir.confidence).toBe('DIVERGE');
        });
});
