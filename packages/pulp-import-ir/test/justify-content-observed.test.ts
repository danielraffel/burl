import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (justifyContent: string, display = 'flex') => lowerObservedDom({
    sourceId: `justify-${justifyContent}`, tagName: 'div',
    rect: { x: 0, y: 0, width: 200, height: 40 }, children: [],
    computedStyle: { display, justifyContent },
} as ObservedDomNode, 'now');

describe('observed CSS justify-content route', () => {
    it('preserves the three distinct observed distribution keywords', () => {
        for (const [source, typed, native] of [
            ['center', 'center', 'center'],
            ['flex-end', 'flex-end', 'end'],
            ['space-between', 'space-between', 'space-between'],
        ] as const) {
            const ir = lower(source);
            expect(ir.layout?.justifyContent).toBe(typed);
            expect(toNativeDesignIrV1(ir, { sourceFile: '/justify', importedAt: 'now' })
                .root.layout?.justify).toBe(native);
        }
    });

    it('lowers normal to start in flex and simple block-to-column-flex contexts', () => {
        for (const display of ['flex', 'block']) {
            const ir = lower('normal', display);
            expect(ir.layout?.justifyContent).toBe('flex-start');
            expect(toNativeDesignIrV1(ir, { sourceFile: '/justify', importedAt: 'now' })
                .root.layout?.justify).toBe('start');
        }
    });

    it('fails closed unknown keywords before the typed native enum boundary', () => {
        const ir = lower('safe center');
        expect(ir.layout?.justifyContent).toBeUndefined();
        expect(ir.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
            property: 'justifyContent', value: 'safe center', code: 'css-keyword-unsupported',
        }));
    });
});
