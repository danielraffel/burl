import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(style: Record<string, string>, text = 'a very long line of text') {
    const source: ObservedDomNode = {
        sourceId: 'overflow-text', tagName: 'span', text,
        computedStyle: { display: 'block', ...style },
        rect: { x: 0, y: 0, width: 80, height: 40 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed text overflow and white space', () => {
    it.each(['clip', 'ellipsis'])('preserves %s with nowrap', (textOverflow) => {
        const ir = lower({ textOverflow, whiteSpace: 'nowrap' });
        expect(ir.text).toMatchObject({ textOverflow, whiteSpace: 'nowrap' });
        expect(toNativeDesignIrV1(ir, { sourceFile: '/overflow', importedAt: 'now' }).root.style)
            .toMatchObject({ textOverflow, whiteSpace: 'nowrap' });
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it('retains a positive webkit line clamp as max lines', () => {
        const native = toNativeDesignIrV1(lower({
            textOverflow: 'ellipsis', whiteSpace: 'normal', webkitLineClamp: '2',
        }), { sourceFile: '/overflow', importedAt: 'now' });
        expect(native.root.style.numberOfLines).toBe(2);
    });

    it.each([
        ['normal', '  a \t b\nc  ', 'a b c'],
        ['nowrap', '  a \t b\nc  ', 'a b c'],
        ['pre', '  a \t b\nc  ', '  a \t b\nc  '],
        ['pre-wrap', '  a \t b\nc  ', '  a \t b\nc  '],
        ['pre-line', '  a \t b\nc  ', 'a b\nc'],
        ['break-spaces', '  a \t b\nc  ', '  a \t b\nc  '],
    ] as const)('preserves the %s white-space contract through native IR', (whiteSpace, sourceText, expectedText) => {
        const ir = lower({ whiteSpace }, sourceText);
        expect(ir.text?.whiteSpace).toBe(whiteSpace);
        expect(ir.text?.text).toBe(expectedText);
        expect(toNativeDesignIrV1(ir, { sourceFile: '/white-space', importedAt: 'now' }).root.style)
            .toMatchObject({ whiteSpace });
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each([{ textOverflow: 'fade' }, { whiteSpace: 'preserve-breaks' }])('fails closed for unsupported syntax', (style) => {
        const ir = lower(style);
        expect(ir.meta?.observed_style_diagnostics?.length).toBeGreaterThan(0);
        expect(ir.confidence).toBe('DIVERGE');
    });
});
