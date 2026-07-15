import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(computedStyle: Record<string, string>) {
    const observed: ObservedDomNode = {
        sourceId: 'ordinary-leaf',
        tagName: 'span',
        computedStyle: { display: 'inline', ...computedStyle },
        rect: { x: 0, y: 0, width: 96, height: 20 },
        text: 'Ordinary text',
        children: [],
    };
    return lowerObservedDom(observed, '2026-07-15T00:00:00Z');
}

describe('observed font-style and visibility', () => {
    it.each(['normal', 'italic', 'oblique'] as const)(
        'preserves computed font-style %s through typed and native IR',
        (fontStyle) => {
            const typed = lower({ fontStyle });
            expect(typed.text?.fontStyle).toBe(fontStyle);

            const native = toNativeDesignIrV1(typed, {
                sourceFile: '/captured-source',
                importedAt: '2026-07-15T00:00:00Z',
            });
            expect(native.root.style.fontStyle).toBe(fontStyle);
        },
    );

    it('preserves visibility without converting hidden into display none or opacity zero', () => {
        const typed = lower({ visibility: 'hidden', opacity: '0.42' });
        expect(typed.paint).toMatchObject({ visibility: 'hidden', opacity: 0.42 });
        expect(typed.layout?.display).toBe('inline');

        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/captured-source',
            importedAt: '2026-07-15T00:00:00Z',
        });
        expect(native.root.style).toMatchObject({ visibility: 'hidden', opacity: 0.42 });
        expect(native.root.layout.display).toBe('inline');
    });

    it('fails closed with a named diagnostic for an unsupported oblique angle', () => {
        const typed = lower({ fontStyle: 'oblique 12deg' });
        expect(typed.text?.fontStyle).toBeUndefined();
        expect(typed.confidence).toBe('DIVERGE');
        expect(typed.meta?.observed_style_diagnostics).toContainEqual({
            code: 'css-font-style-unsupported',
            property: 'fontStyle',
            value: 'oblique 12deg',
        });
    });
});
