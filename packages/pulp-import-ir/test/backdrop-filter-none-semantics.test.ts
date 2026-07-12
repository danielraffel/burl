import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('backdrop-filter none semantic route', () => {
    it('preserves identity as an explicit native clearing value', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/backdrop-filter-none.v1.json',
        ), 'utf8'));
        const typed = lowerObservedDom(fixture.observedDom as ObservedDomNode, '2026-07-12T00:00:00Z');
        expect(typed.paint?.backdropFilter).toHaveLength(fixture.expected.typedBackdropFilterCount);
        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/backdrop-filter-none.v1.json', importedAt: '2026-07-12T00:00:00Z',
        });
        expect(native.root.style?.backdropFilter).toBe(fixture.expected.nativeBackdropFilter);
    });
});
