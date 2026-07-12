import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (filter: string, backdropFilter = 'none') => lowerObservedDom({ sourceId: filter, tagName: 'div',
    computedStyle: { display: 'block', filter, backdropFilter },
    rect: { x: 0, y: 0, width: 20, height: 20 }, children: [] } as ObservedDomNode, 'now');

describe('observed CSS filter route', () => {
    it('preserves ordered supported chains and explicit none', () => {
        const chain = lower('invert(1) opacity(0.5) brightness(120%)');
        expect(chain.paint?.filter).toEqual([
            { fn: 'invert', amount: 1 }, { fn: 'opacity', amount: 0.5 }, { fn: 'brightness', amount: 1.2 },
        ]);
        expect(toNativeDesignIrV1(chain, { sourceFile: '/filter', importedAt: 'now' }).root.style?.filter)
            .toBe('invert(1) opacity(0.5) brightness(1.2)');
        const none = lower('none');
        expect(none.paint?.filter).toEqual([]);
        expect(toNativeDesignIrV1(none, { sourceFile: '/filter-none', importedAt: 'now' }).root.style?.filter).toBe('none');
    });

    it('fails closed unknown and URL filters without conflating backdrop', () => {
        for (const value of ['url(filter.svg#x)', 'unknown(1)']) {
            const typed = lower(value, 'blur(4px)');
            expect(typed.paint?.filter).toBeUndefined();
            expect(typed.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
                property: 'filter', code: 'css-filter-unsupported', value,
            }));
        }
    });
});
