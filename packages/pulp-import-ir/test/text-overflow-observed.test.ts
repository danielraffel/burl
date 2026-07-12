import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(style: Record<string, string>) {
    const source: ObservedDomNode = {
        sourceId: 'overflow-text', tagName: 'span', text: 'a very long line of text',
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

    it.each([{ textOverflow: 'fade' }, { whiteSpace: 'break-spaces' }])('fails closed for unsupported syntax', (style) => {
        const ir = lower(style);
        expect(ir.meta?.observed_style_diagnostics?.length).toBeGreaterThan(0);
        expect(ir.confidence).toBe('DIVERGE');
    });
});
