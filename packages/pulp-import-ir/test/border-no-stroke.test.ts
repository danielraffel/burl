import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('computed border no-stroke route', () => {
    it('decomposes shorthand into exact width/color skin inputs', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/border-no-stroke.v1.json',
        ), 'utf8'));
        for (const [index, item] of fixture.cases.entries()) {
            const observed: ObservedDomNode = {
                sourceId: `border-${index}`, tagName: 'button',
                computedStyle: { display: 'flex', border: item.border,
                    borderWidth: item.width, borderColor: item.color },
                rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
            };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.paint?.borderWidth).toBe(item.normalizedWidth);
            expect(typed.paint?.borderColor).toBe(item.normalizedColor);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/border', importedAt: 'now' });
            expect(native.root.visualSkin?.states.rest.borderWidth).toBe(item.normalizedWidth);
        }
    });
});
