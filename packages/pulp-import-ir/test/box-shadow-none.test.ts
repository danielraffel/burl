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
});
