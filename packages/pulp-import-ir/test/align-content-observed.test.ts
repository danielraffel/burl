import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(alignContent: string) {
    const observed: ObservedDomNode = {
        sourceId: `align-content-${alignContent}`,
        tagName: 'div',
        computedStyle: {
            display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignContent,
        },
        rect: { x: 0, y: 0, width: 100, height: 100 },
        children: [],
    };
    return lowerObservedDom(observed, '2026-07-12T00:00:00Z');
}

describe('observed CSS align-content route', () => {
    it('starts from the observed-DOM semantic fixture and preserves normal for display-aware native lowering', () => {
        const fixture = JSON.parse(readFileSync(resolve(
            '../../tools/import-design/test/fixtures/compat-semantics/align-content-normal.v1.json',
        ), 'utf8'));
        const typed = lowerObservedDom(fixture.observedDom as ObservedDomNode, '2026-07-12T00:00:00Z');
        expect(typed.layout?.alignContent).toBe(fixture.expected.typedAlignContent);
        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/align-content-normal.v1.json', importedAt: '2026-07-12T00:00:00Z',
        });
        expect(native.root.layout?.alignContent).toBe(fixture.expected.nativeAlignContent);
        expect(typed.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each([
        'normal', 'start', 'flex-start', 'center', 'end', 'flex-end', 'stretch',
        'baseline', 'space-between', 'space-around', 'space-evenly',
    ])('preserves supported value %s through typed and native IR', (value) => {
        const typed = lower(value);
        expect(typed.layout?.alignContent).toBe(value);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/align-content', importedAt: 'now' });
        const expected = value === 'flex-start' ? 'start' : value === 'flex-end' ? 'end' : value;
        expect(native.root.layout?.alignContent).toBe(expected);
        expect(typed.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each(['safe center', 'first baseline', 'legacy'])('fails closed for unsupported value %s', (value) => {
        const typed = lower(value);
        expect(typed.layout?.alignContent).toBeUndefined();
        expect(typed.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-keyword-unsupported', property: 'alignContent', value }),
        ]));
        expect(typed.confidence).toBe('DIVERGE');
    });
});
