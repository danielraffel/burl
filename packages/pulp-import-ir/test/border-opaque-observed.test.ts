import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed opaque uniform border route', () => {
    it('preserves CSS Color 4 alpha and one-pixel width through VisualSkin', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/border-opaque-observed.v1.json',
        ), 'utf8'));
        for (const [index, item] of fixture.cases.entries()) {
            const observed: ObservedDomNode = {
                sourceId: `opaque-border-${index}`, tagName: 'button',
                computedStyle: { display: 'flex', border: item.input,
                    borderWidth: `${item.width}px`, borderColor: item.computedColor },
                rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
            };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.paint?.borderColor).toBe(item.normalizedColor);
            expect(typed.paint?.borderWidth).toBe(item.width);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/border', importedAt: 'now' });
            expect(native.root.visualSkin?.states.rest.border).toEqual({
                r: 46, g: 46, b: 46, a: Number.parseInt(item.normalizedColor.slice(7), 16),
            });
            expect(native.root.visualSkin?.states.rest.borderWidth).toBe(1);
        }
    });
});
