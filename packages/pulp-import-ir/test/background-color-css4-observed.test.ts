import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCssColor } from '../src/css-color.js';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const fixture = JSON.parse(readFileSync(resolve(
    '../../tools/import-design/test/fixtures/compat-semantics/background-color-css4-observed.v1.json',
), 'utf8'));

describe('observed CSS Color 4 background route', () => {
    it('canonicalizes encoded sRGB, OKLab, OKLCH, alpha, and clamping', () => {
        for (const item of [...fixture.cases, ...fixture.parserControls])
            expect(normalizeCssColor(item.input).value).toBe(item.normalized);
    });

    it('preserves every observed value through typed and native DesignIR', () => {
        for (const [index, item] of fixture.cases.entries()) {
            const observed: ObservedDomNode = {
                sourceId: `css4-${index}`, tagName: 'div',
                computedStyle: { display: 'block', backgroundColor: item.input },
                rect: { x: 0, y: 0, width: 10, height: 10 }, children: [],
            };
            const typed = lowerObservedDom(observed, '2026-07-12T00:00:00Z');
            expect(typed.paint?.backgroundColor).toBe(item.normalized);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/css4', importedAt: 'now' });
            expect(native.root.style?.backgroundColor).toBe(item.normalized);
        }
    });
});
