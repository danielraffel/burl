import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';
import { parseObservedBackgroundLayers } from '../src/adapters/observed-dom/gradient.js';

describe('ordered background layers with calc stops', () => {
    it('preserves CSS paint order and affine stop components', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/background-layers-calc.v1.json',
        ), 'utf8'));
        const observed: ObservedDomNode = {
            sourceId: 'layers', tagName: 'div',
            computedStyle: { display: 'block', backgroundImage: fixture.input },
            rect: { x: 0, y: 0, width: 100, height: 20 }, children: [],
        };
        const typed = lowerObservedDom(observed, '2026-07-12T00:00:00Z');
        expect(typed.paint?.backgroundLayers).toHaveLength(fixture.expected.layerCount);
        expect(typed.paint?.backgroundLayers?.[0].stops.map((stop) => stop.offset)).toEqual(
            fixture.expected.topStopFractions);
        expect(typed.paint?.backgroundLayers?.[0].stops.map((stop) => stop.offsetPixels ?? 0)).toEqual(
            fixture.expected.topStopPixels);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/layers', importedAt: 'now' });
        expect(native.root.style?.backgroundLayers).toEqual(typed.paint?.backgroundLayers?.map((layer) => layer.css));
    });

    it('fails closed for nonlinear multilayers until every layer kind appends', () => {
        expect(parseObservedBackgroundLayers(
            'radial-gradient(#ff0000, #0000ff), linear-gradient(#ff0000, #0000ff)',
        ).diagnostic?.code).toBe('gradient-nonlinear-multilayer-unsupported');
    });
});
