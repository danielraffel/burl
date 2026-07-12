import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('box-shadow none identity', () => {
    it('preserves explicit empty layers distinctly from missing shadow', () => {
        const node = (boxShadow?: string): ObservedDomNode => ({ sourceId: boxShadow ?? 'missing', tagName: 'div',
            computedStyle: { display: 'block', ...(boxShadow === undefined ? {} : { boxShadow }) },
            rect: { x: 0, y: 0, width: 100, height: 30 }, children: [] });
        const none = lowerObservedDom(node('none'), 'now');
        expect(none.paint?.boxShadow).toEqual([]);
        expect(toNativeDesignIrV1(none, { sourceFile: '/none', importedAt: 'now' }).root.style?.boxShadow).toBe('none');
        const missing = lowerObservedDom(node(), 'now');
        expect(missing.paint?.boxShadow).toBeUndefined();
        expect(toNativeDesignIrV1(missing, { sourceFile: '/missing', importedAt: 'now' }).root.style?.boxShadow).toBeUndefined();
    });

    it('preserves ordered multi-layer geometry and normalized colors', () => {
        const values = [
            'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(255, 255, 255) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px',
            'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px',
            'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px',
        ];
        for (const value of values) {
            const observed: ObservedDomNode = { sourceId: value, tagName: 'div',
                computedStyle: { display: 'block', boxShadow: value },
                rect: { x: 0, y: 0, width: 100, height: 30 }, children: [] };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.paint?.boxShadow).toHaveLength(5);
            expect(typed.paint?.boxShadow?.map(({ offsetX, offsetY, blur, spread }) =>
                [offsetX, offsetY, blur, spread])).toEqual(value.includes('1px 2px')
                    ? [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,1,2,0]]
                    : Array(5).fill([0,0,0,0]));
            const native = toNativeDesignIrV1(typed, { sourceFile: '/shadow', importedAt: 'now' });
            expect(native.root.style?.boxShadow).toBeTypeOf('string');
        }
    });
});
