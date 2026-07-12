import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('align-items normal semantic route', () => {
    it('lowers normal by observed display context', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/align-items-normal.v1.json',
        ), 'utf8'));
        for (const [index, semanticCase] of fixture.cases.entries()) {
            const observedDom: ObservedDomNode = {
                sourceId: `align-items-normal-${index}`, tagName: 'div',
                computedStyle: {
                    display: semanticCase.display,
                    alignItems: semanticCase.computedAlignItems,
                },
                rect: { x: 0, y: 0, width: 100, height: 100 }, children: [],
            };
            const typed = lowerObservedDom(observedDom, '2026-07-12T00:00:00Z');
            expect(typed.layout?.alignItems).toBe(semanticCase.typedLayoutAlignItems);
            const native = toNativeDesignIrV1(typed, {
                sourceFile: '/align-items-normal.v1.json', importedAt: '2026-07-12T00:00:00Z',
            });
            expect(native.root.layout?.align).toBe(semanticCase.nativeDesignIrAlign);
        }
    });
});
