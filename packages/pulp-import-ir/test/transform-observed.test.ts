import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(transform: string, transformOrigin = '50% 50%') {
    const source: ObservedDomNode = {
        sourceId: 'transform', tagName: 'div', computedStyle: { display: 'flex', transform, transformOrigin },
        rect: { x: 0, y: 0, width: 100, height: 60 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed 2D transforms', () => {
    it.each(['matrix(1, 0, 0, 1, 12, 8)', 'translate(12px, 8px)', 'scale(1.5)', 'rotate(30deg)', 'none'])
        ('preserves %s', (transform) => {
            const ir = lower(transform);
            expect(ir.paint).toMatchObject({ transform, transformOrigin: '50% 50%' });
            expect(toNativeDesignIrV1(ir, { sourceFile: '/transform', importedAt: 'now' }).root.style)
                .toMatchObject({ transform, transformOrigin: '50% 50%' });
            expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
        });

    it.each(['matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)', 'perspective(100px)', 'translateX(50%)'])
        ('fails closed for %s', (transform) => {
            const ir = lower(transform);
            expect(ir.paint?.transform).toBeUndefined();
            expect(ir.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: 'css-transform-unsupported', property: 'transform', value: transform }),
            ]));
        });
});
