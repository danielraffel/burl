import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed rgb background route', () => {
    it('preserves every observed integer and alpha value through native DesignIR', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/background-color-rgb-observed.v1.json',
        ), 'utf8'));
        for (const [index, item] of fixture.cases.entries()) {
            const observed: ObservedDomNode = {
                sourceId: `rgb-${index}`, tagName: 'div',
                computedStyle: { display: 'block', backgroundColor: item.input },
                rect: { x: 0, y: 0, width: 10, height: 10 }, children: [],
            };
            const typed = lowerObservedDom(observed, '2026-07-12T00:00:00Z');
            expect(typed.paint?.backgroundColor).toBe(item.normalized);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/rgb', importedAt: 'now' });
            expect(native.root.style?.backgroundColor).toBe(item.normalized);
        }
    });
});
