import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(textAlign: string, direction = 'ltr') {
    const source: ObservedDomNode = {
        sourceId: 'align', tagName: 'span', text: 'alpha beta',
        computedStyle: { display: 'block', textAlign, direction },
        rect: { x: 0, y: 0, width: 200, height: 40 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed text alignment', () => {
    it.each(['left', 'right', 'center', 'start', 'end'])('preserves %s and direction', (value) => {
        const ir = lower(value, 'rtl');
        expect(ir.text).toMatchObject({ textAlign: value, direction: 'rtl' });
        expect(toNativeDesignIrV1(ir, { sourceFile: '/align', importedAt: 'now' }).root.style)
            .toMatchObject({ textAlign: value, direction: 'rtl' });
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each(['justify', 'match-parent'])('fails closed for unproven %s', (value) => {
        const ir = lower(value);
        expect(ir.text?.textAlign).toBeUndefined();
        expect(ir.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-text-align-unsupported', property: 'textAlign', value }),
        ]));
    });
});
