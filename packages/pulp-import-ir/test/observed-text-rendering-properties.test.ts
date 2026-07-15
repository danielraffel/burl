import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(computedStyle: Record<string, string>) {
    const observed: ObservedDomNode = {
        sourceId: 'text-properties', tagName: 'span',
        computedStyle: { display: 'inline', ...computedStyle },
        rect: { x: 0, y: 0, width: 100, height: 20 },
        text: '0123', children: [],
    };
    return lowerObservedDom(observed, 'now');
}

describe('observed text rendering properties', () => {
    it('preserves authored OpenType feature settings and text rendering intent', () => {
        const typed = lower({
            fontFeatureSettings: '"ss03" 1, "rlig" 1, "calt" 1',
            textRendering: 'optimizeLegibility',
        });
        expect(typed.text?.fontFeatureSettings).toBe('"ss03" 1, "rlig" 1, "calt" 1');
        expect(typed.text?.textRendering).toBe('optimizeLegibility');

        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/captured-palot', importedAt: 'now',
        });
        expect(native.root.style).toMatchObject({
            fontFeatureSettings: '"ss03" 1, "rlig" 1, "calt" 1',
            textRendering: 'optimizeLegibility',
        });
    });

    it('canonicalizes the lowercase computed value emitted by the Palot capture', () => {
        const typed = lower({
            fontFeatureSettings: '"calt", "rlig", "ss03"',
            textRendering: 'optimizelegibility',
        });
        expect(typed.text).toMatchObject({
            fontFeatureSettings: '"calt", "rlig", "ss03"',
            textRendering: 'optimizeLegibility',
        });
    });

    it('does not inflate the IR with computed defaults', () => {
        const typed = lower({ fontFeatureSettings: 'normal', textRendering: 'auto' });
        expect(typed.text?.fontFeatureSettings).toBeUndefined();
        expect(typed.text?.textRendering).toBeUndefined();
    });
});
