import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(overflowWrap: string, wordWrap?: string) {
    const source: ObservedDomNode = {
        sourceId: 'wrap', tagName: 'span', text: 'averyveryverylongword',
        computedStyle: { display: 'block', overflowWrap, ...(wordWrap ? { wordWrap } : {}) },
        rect: { x: 0, y: 0, width: 64, height: 40 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed CSS overflow-wrap', () => {
    it.each(['normal', 'break-word', 'anywhere'])('preserves %s through native IR', (value) => {
        const ir = lower(value);
        expect(ir.text?.overflowWrap).toBe(value);
        expect(toNativeDesignIrV1(ir, { sourceFile: '/wrap', importedAt: 'now' }).root.style.overflowWrap)
            .toBe(value);
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it('keeps canonical overflow-wrap ahead of the word-wrap alias', () => {
        const native = toNativeDesignIrV1(lower('normal', 'break-word'), {
            sourceFile: '/wrap', importedAt: 'now',
        });
        expect(native.root.style).toMatchObject({ overflowWrap: 'normal', wordWrap: 'break-word' });
    });

    it.each(['initial-ish', 'break-all'])('fails closed for unsupported %s', (value) => {
        const ir = lower(value);
        expect(ir.text?.overflowWrap).toBeUndefined();
        expect(ir.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-overflow-wrap-unsupported', property: 'overflowWrap', value }),
        ]));
    });
});
