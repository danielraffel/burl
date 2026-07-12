import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function fixture(computedStyle: Record<string, string>): ObservedDomNode {
    return {
        sourceId: 'neutral-control', tagName: 'button', text: 'Neutral', computedStyle,
        rect: { x: 10, y: 20, width: 160, height: 36 }, children: [],
    };
}

describe('ObservedStyleProjection v2', () => {
    it('preserves responsive layout, asymmetric geometry, shadow, cursor, and text overflow', () => {
        const ir = lowerObservedDom(fixture({
            display: 'flex', flexDirection: 'row', flexGrow: '1', flexShrink: '0', flexBasis: '0%',
            position: 'absolute', top: '8px', right: '12px', bottom: 'auto', left: '12px',
            minWidth: '120px', maxWidth: '480px', minHeight: '24px', maxHeight: '128px',
            gap: '2px 6px', overflowX: 'hidden', overflowY: 'auto',
            backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(230, 230, 230)',
            borderTopWidth: '1px', borderRightWidth: '2px', borderBottomWidth: '3px', borderLeftWidth: '4px',
            borderRadius: '10px 0px 4px 2px', cursor: 'pointer',
            boxShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 2px 0px', opacity: '0.8',
            fontSize: '13px', textOverflow: 'ellipsis', overflowWrap: 'anywhere', wordWrap: 'break-word',
        }), 'now');
        expect(ir.layout).toMatchObject({
            flexGrow: 1, flexShrink: 0, flexBasis: '0%', position: 'absolute',
            top: 8, right: 12, bottom: 'auto', left: 12,
            minWidth: 120, maxWidth: 480, minHeight: 24, maxHeight: 128,
            rowGap: 2, columnGap: 6, overflowX: 'hidden', overflowY: 'auto',
        });
        expect(ir.paint).toMatchObject({
            backgroundColor: '#00000000', borderTopWidth: 1, borderRightWidth: 2,
            borderBottomWidth: 3, borderLeftWidth: 4,
            borderTopLeftRadius: 10, borderTopRightRadius: 0,
            borderBottomRightRadius: 4, borderBottomLeftRadius: 2,
            cursor: 'pointer', opacity: 0.8,
        });
        expect(ir.paint?.boxShadow).toEqual([{
            offsetX: 0, offsetY: 1, blur: 2, spread: 0, color: '#00000040',
        }]);
        expect(ir.text).toMatchObject({ textOverflow: 'ellipsis', overflowWrap: 'anywhere', wordWrap: 'break-word' });
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
        const native = toNativeDesignIrV1(ir, { sourceFile: '/neutral', importedAt: 'now' });
        expect(native.root.style).toMatchObject({
            borderTopWidth: 1, borderRightWidth: 2, borderBottomWidth: 3, borderLeftWidth: 4,
            borderTopLeftRadius: 10, borderTopRightRadius: 0,
            borderBottomRightRadius: 4, borderBottomLeftRadius: 2,
            boxShadow: '0px 1px 2px 0px #00000040', textOverflow: 'ellipsis',
        });
        expect(native.root.layout).toMatchObject({
            flexGrow: 1, flexShrink: 0, flexBasis: '0%', rowGap: 2, columnGap: 6,
            overflowX: 'hidden', overflowY: 'auto',
        });
        expect(native.root.style).not.toHaveProperty('width');
    });

    it('fails closed with named diagnostics for captured unsupported effects', () => {
        const ir = lowerObservedDom(fixture({
            display: 'flex', overflowX: 'overlay', overflowY: 'visible',
            backgroundImage: 'linear-gradient(90deg, red, blue)', transform: 'translateX(2px)',
            filter: 'blur(2px)', backdropFilter: 'saturate(1.2)', boxShadow: 'var(--unresolved-shadow)',
        }), 'now');
        expect(ir.confidence).toBe('DIVERGE');
        expect(ir.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'css-overflow-unsupported', property: 'overflowX' }),
            expect.objectContaining({ code: 'css-background-image-unsupported', property: 'backgroundImage' }),
            expect.objectContaining({ code: 'css-backdrop-filter-unsupported', property: 'backdropFilter' }),
            expect.objectContaining({ code: 'css-shadow-unsupported', property: 'boxShadow' }),
        ]));
    });

    it('retains responsive min/max dimensions including linear calc', () => {
        const ir = lowerObservedDom(fixture({
            display: 'flex', minWidth: '0px', minHeight: 'auto',
            maxWidth: 'calc(100% - 64px)', maxHeight: '95%',
        }), 'now');
        expect(ir.layout).toMatchObject({
            minWidth: 0, minHeight: 'auto', maxWidth: 'calc(100% - 64px)', maxHeight: '95%',
        });
        expect(ir.meta?.observed_style_diagnostics).toBeUndefined();
        const native = toNativeDesignIrV1(ir, { sourceFile: '/responsive', importedAt: 'now' });
        expect(native.root.style).toMatchObject({
            minWidth: 0, minHeight: 'auto', maxWidth: 'calc(100% - 64px)', maxHeight: '95%',
        });
    });
});
