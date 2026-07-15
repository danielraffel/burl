import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(width: string, boxSizing = 'border-box') {
    const source: ObservedDomNode = {
        sourceId: 'width', tagName: 'div', computedStyle: { display: 'flex', width, boxSizing },
        rect: { x: 0, y: 0, width: 10.9922, height: 20 }, children: [],
    };
    return lowerObservedDom(source, 'now');
}

describe('observed CSS width', () => {
    it.each(['10.9922px', '37.5%', 'calc(100% - 64px)', 'auto'])('preserves %s', (width) => {
        const ir = lower(width);
        const expected = width === '10.9922px' ? 10.9922 : width;
        expect(ir.layout?.width).toBe(expected);
        if (ir.meta) (ir.meta as Record<string, unknown>).observed_viewport_fill = false;
        expect(toNativeDesignIrV1(ir, { sourceFile: '/width', importedAt: 'now' }).root.style.width).toBe(expected);
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
    });

    it.each(['min-content', 'max-content', 'fit-content(20px)', '-1px'])('fails closed for %s', (width) => {
        const ir = lower(width);
        expect(ir.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-width-unsupported', property: 'width', value: width }),
        ]));
        expect(ir.confidence).toBe('DIVERGE');
    });

    it('distinguishes initial auto sizing from a computed used pixel width', () => {
        const source: ObservedDomNode = {
            sourceId: 'auto-width', tagName: 'h2', text: 'Source title',
            computedStyle: { display: 'block', width: '210.867px', height: '13px' },
            styleProvenance: {}, styleProvenanceComplete: true,
            rect: { x: 0, y: 0, width: 210.867, height: 13 }, children: [],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout?.width).toBe('auto');
        expect(ir.layout?.height).toBe('auto');
        const native = toNativeDesignIrV1(ir, { sourceFile: '/auto-width', importedAt: 'now' }).root;
        // Native DesignIR represents CSS auto sizing by omitting a concrete
        // width; emitting the browser's used pixels here would freeze reflow.
        expect(native.style.width).toBeUndefined();
        expect(native.style.height).toBeUndefined();
    });

    it('retains the authored responsive width instead of freezing its observed used pixels', () => {
        const source: ObservedDomNode = {
            sourceId: 'authored-width', tagName: 'div', computedStyle: { display: 'block', width: '210.867px' },
            styleProvenance: { width: [{ value: '50%', origin: 'authored' }] },
            styleProvenanceComplete: true,
            styleProvenanceWinners: { width: '50%' },
            rect: { x: 0, y: 0, width: 210.867, height: 13 }, children: [],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout?.width).toBe('50%');
        if (ir.meta) (ir.meta as Record<string, unknown>).observed_viewport_fill = false;
        expect(toNativeDesignIrV1(ir, { sourceFile: '/authored-width', importedAt: 'now' }).root.style.width)
            .toBe('50%');
    });

    it('uses a captured 100% cascade winner even when property completeness is scoped elsewhere', () => {
        const source: ObservedDomNode = {
            sourceId: 'full-width-utility', tagName: 'div',
            computedStyle: { display: 'flex', width: '842.648px', marginLeft: '340.352px' },
            styleProvenance: {
                width: [{ value: '100%', origin: 'authored', selector: '.w-full' }],
                'margin-left': [{ value: 'auto', origin: 'authored', selector: '.ml-auto' }],
            },
            styleProvenanceComplete: false,
            styleProvenanceCompleteProperties: ['margin-left'],
            styleProvenanceWinners: { width: '100%', 'margin-left': 'auto' },
            rect: { x: 340.352, y: 0, width: 842.648, height: 68 }, children: [],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout).toMatchObject({ width: '100%', marginLeft: 'auto' });
        if (ir.meta) (ir.meta as Record<string, unknown>).observed_viewport_fill = false;
        const native = toNativeDesignIrV1(ir, {
            sourceFile: '/full-width-utility', importedAt: 'now',
        }).root;
        expect(native.style.width).toBe('100%');
        expect(native.layout).toMatchObject({ marginLeft: 'auto' });
    });

    it('preserves authored full width and auto margin through block-to-column parent lowering', () => {
        const collection: ObservedDomNode = {
            sourceId: 'user-collection', tagName: 'div',
            computedStyle: {
                display: 'flex', width: '842.648px', marginLeft: '340.352px',
                marginRight: '0px', marginTop: '0px', marginBottom: '0px',
            },
            styleProvenance: {
                width: [{ value: '100%', origin: 'authored', selector: '.w-full' }],
                'margin-left': [{ value: 'auto', origin: 'authored', selector: '.ml-auto' }],
            },
            styleProvenanceComplete: false,
            styleProvenanceCompleteProperties: ['margin-left'],
            styleProvenanceWinners: { width: '100%', 'margin-left': 'auto' },
            rect: { x: 340.352, y: 0, width: 842.648, height: 68 }, children: [],
        };
        const root: ObservedDomNode = {
            sourceId: 'conversation-flow', tagName: 'main',
            computedStyle: {
                display: 'block', width: '1183px', paddingLeft: '0px', paddingRight: '0px',
                paddingTop: '0px', borderLeftWidth: '0px', borderRightWidth: '0px',
            },
            rect: { x: 0, y: 0, width: 1183, height: 68 }, children: [collection],
        };

        const ir = lowerObservedDom(root, 'now');
        expect(ir.layout).toMatchObject({ display: 'flex', flexDirection: 'column' });
        expect(ir.children[0].layout).toMatchObject({ width: '100%', marginLeft: 'auto' });
        if (ir.meta) (ir.meta as Record<string, unknown>).observed_viewport_fill = false;
        const native = toNativeDesignIrV1(ir, {
            sourceFile: '/block-parent-authored-width', importedAt: 'now',
        }).root.children[0];
        expect(native.style.width).toBe('100%');
        expect(native.layout).toMatchObject({ marginLeft: 'auto' });
    });

    it('keeps authored relative width when a measured responsive constraint also owns the axis', () => {
        const ir = lower('100%');
        if (ir.meta) (ir.meta as Record<string, unknown>).observed_viewport_fill = false;
        ir.responsive = {
            horizontal: { kind: 'min', min: 0, ratio: 0.95, offset: 0, residual: 0 },
            sampledViewports: [600, 1200],
        };
        const native = toNativeDesignIrV1(ir, { sourceFile: '/responsive-width', importedAt: 'now' }).root;
        expect(native.style.width).toBe('100%');
        expect(native.responsive?.horizontal).toMatchObject({ kind: 'min', ratio: 0.95 });
    });

    it('does not infer auto from an incomplete empty declaration capture', () => {
        const source: ObservedDomNode = {
            sourceId: 'unknown-width', tagName: 'div', computedStyle: { display: 'block', width: '280px' },
            styleProvenance: {}, styleProvenanceComplete: false,
            rect: { x: 0, y: 0, width: 280, height: 20 }, children: [],
        };
        expect(lowerObservedDom(source, 'now').layout?.width).toBe(280);
    });

    it('lowers an undeclared used width from property-scoped matched-style evidence as auto', () => {
        const source: ObservedDomNode = {
            sourceId: 'property-scoped-auto-width', tagName: 'span', text: 'General',
            computedStyle: { display: 'block', width: '54.4375px', height: '20px' },
            styleProvenance: {}, styleProvenanceComplete: false,
            styleProvenanceCompleteProperties: ['width'],
            styleProvenanceWinners: { width: 'auto' },
            rect: { x: 0, y: 0, width: 54.4375, height: 20 }, children: [],
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.layout?.width).toBe('auto');
        expect(toNativeDesignIrV1(ir, {
            sourceFile: '/property-scoped-auto-width', importedAt: 'now',
        }).root.style.width).toBeUndefined();
    });
});
