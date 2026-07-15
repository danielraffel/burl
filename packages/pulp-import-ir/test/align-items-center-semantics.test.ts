import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('align-items center semantic route', () => {
    it('preserves computed browser semantics through typed and native DesignIR', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/align-items-center.v1.json',
        ), 'utf8'));
        const typed = lowerObservedDom(fixture.observedDom as ObservedDomNode, '2026-07-12T00:00:00Z');
        expect(typed.layout?.alignItems).toBe(fixture.expected.typedLayoutAlignItems);
        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/align-items-center.v1.json', importedAt: '2026-07-12T00:00:00Z',
        });
        expect(native.root.layout?.align).toBe(fixture.expected.nativeDesignIrAlign);
    });

    it('preserves first-baseline alignment instead of collapsing it to start', () => {
        const observed: ObservedDomNode = {
            sourceId: 'baseline-row', tagName: 'div',
            computedStyle: { display: 'flex', flexDirection: 'row', alignItems: 'baseline' },
            rect: { x: 0, y: 0, width: 240, height: 60 }, children: [],
        };
        const typed = lowerObservedDom(observed, '2026-07-12T00:00:00Z');
        expect(typed.layout?.alignItems).toBe('baseline');
        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/align-items-baseline.json', importedAt: '2026-07-12T00:00:00Z',
        });
        expect(native.root.layout?.align).toBe('baseline');
    });
});
