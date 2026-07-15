import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const observedPixels = [
    0, 1, 8, 10, 11, 12, 13, 13.75, 14, 15, 16, 16.25, 16.5, 18, 20, 22, 22.5,
    24, 24.5, 26, 28, 30, 32, 39, 44, 44.5, 45, 46, 52.5, 53, 56, 64, 68, 84,
    88, 104, 105.5, 106, 107, 112, 116, 118, 136.5, 140, 152, 160.5, 182, 186,
    188, 224, 248.5, 413, 581.5, 593, 596, 641, 666, 742, 788, 800,
];

const lower = (height: string, rectHeight: number) => lowerObservedDom({
    sourceId: 'viewport', tagName: 'main', rect: { x: 0, y: 0, width: 200, height: 900 },
    computedStyle: { display: 'flex', height: '900px' },
    children: [{
        sourceId: `height-${height}`, tagName: 'div',
        rect: { x: 0, y: 0, width: 120, height: rectHeight }, children: [],
        computedStyle: { display: 'flex', height },
    }],
} as ObservedDomNode, 'now').children[0];

describe('observed CSS height route', () => {
    it('preserves all 60 observed pixel values via clustered parameterization', () => {
        expect(observedPixels).toHaveLength(60);
        for (const height of observedPixels) {
            const ir = lower(`${height}px`, height);
            expect(ir.layout?.height).toBe(height);
            const native = toNativeDesignIrV1(ir, { sourceFile: '/height', importedAt: 'now' });
            expect(native.root.layout).toMatchObject({ heightMode: 'fixed', height });
            expect(native.root.style?.height).toBe(height);
        }
    });

    it('preserves auto as intrinsic hug sizing rather than freezing the capture rectangle', () => {
        const ir = lower('auto', 37.5);
        expect(ir.layout?.height).toBe('auto');
        const native = toNativeDesignIrV1(ir, { sourceFile: '/height', importedAt: 'now' });
        expect(native.root.layout).toMatchObject({ heightMode: 'hug' });
        expect(native.root.layout?.height).toBeUndefined();
        expect(native.root.style?.height).toBeUndefined();
    });

    it('uses complete cascade provenance to recover authored auto from the browser used height', () => {
        const source = {
            sourceId: 'auto-height-used-pixels', tagName: 'div',
            rect: { x: 0, y: 0, width: 240, height: 90 }, children: [],
            computedStyle: { display: 'flex', height: '90px' },
            styleProvenance: { height: [] },
            styleProvenanceCompleteProperties: ['height'],
            styleProvenanceWinners: { height: 'auto' },
        } as ObservedDomNode;
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout?.height).toBe('auto');
        expect(toNativeDesignIrV1(ir, { sourceFile: '/height-provenance', importedAt: 'now' }).root.layout)
            .toMatchObject({ heightMode: 'hug' });
    });

    it('keeps used pixels when height provenance is incomplete', () => {
        const source = {
            sourceId: 'unknown-height-provenance', tagName: 'div',
            rect: { x: 0, y: 0, width: 240, height: 90 }, children: [],
            computedStyle: { display: 'flex', height: '90px' },
            styleProvenance: { height: [] }, styleProvenanceComplete: false,
        } as ObservedDomNode;
        expect(lowerObservedDom(source, 'now').layout?.height).toBe(90);
    });

    it('preserves an authored relative height from the captured cascade winner', () => {
        const source = {
            sourceId: 'relative-height-used-pixels', tagName: 'div',
            rect: { x: 0, y: 0, width: 240, height: 450 }, children: [],
            computedStyle: { display: 'flex', height: '450px' },
            styleProvenance: { height: [{ value: '50%', origin: 'authored' }] },
            styleProvenanceComplete: false,
            styleProvenanceWinners: { height: '50%' },
        } as ObservedDomNode;
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout?.height).toBe('50%');
        if (ir.meta) (ir.meta as Record<string, unknown>).observed_viewport_fill = false;
        expect(toNativeDesignIrV1(ir, { sourceFile: '/relative-height', importedAt: 'now' }).root.style?.height)
            .toBe('50%');
    });

});
