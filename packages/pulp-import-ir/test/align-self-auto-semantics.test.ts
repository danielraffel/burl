import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('align-self auto semantic route', () => {
    it('preserves inheritance through typed and native DesignIR', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/align-self-auto.v1.json',
        ), 'utf8'));
        const typed = lowerObservedDom(fixture.observedDom as ObservedDomNode, '2026-07-12T00:00:00Z');
        expect(typed.children[0].layout?.alignSelf).toBe(fixture.expected.typedAlignSelf);
        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/align-self-auto.v1.json', importedAt: '2026-07-12T00:00:00Z',
        });
        expect(native.root.children[0].layout?.alignSelf).toBe(fixture.expected.nativeAlignSelf);
    });
});
