import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('transparent color(srgb) semantic route', () => {
    it('preserves alpha zero without a theme fallback', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/background-color-srgb-transparent.v1.json',
        ), 'utf8'));
        const typed = lowerObservedDom(fixture.observedDom as ObservedDomNode, '2026-07-12T00:00:00Z');
        expect(typed.paint?.backgroundColor).toBe(fixture.expected.typedColor);
        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/background-color-srgb-transparent.v1.json', importedAt: '2026-07-12T00:00:00Z',
        });
        expect(native.root.style?.backgroundColor).toBe(fixture.expected.nativeColor);
    });
});
