import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function button(sourceId: string, backgroundColor: string, selected = false): ObservedDomNode {
    return {
        sourceId,
        tagName: 'button',
        text: sourceId,
        attributes: selected ? { 'aria-pressed': 'true' } : {},
        computedStyle: {
            display: 'flex', backgroundColor, color: 'rgb(230, 235, 240)',
            borderColor: 'rgb(61, 72, 84)', borderWidth: '1px', borderRadius: '8px',
            fontFamily: 'system-ui', fontSize: '13px', fontWeight: '600',
            lineHeight: '16px', letterSpacing: '0px', textAlign: 'center',
            paddingLeft: '10px', paddingRight: '10px', paddingTop: '4px', paddingBottom: '4px',
        },
        stateStyles: {
            hover: { backgroundColor: 'rgba(42, 52, 64, 0.8)', color: 'rgb(255, 255, 255)' },
        },
        rect: { x: 0, y: 0, width: 140, height: 32 },
        children: [],
    };
}

describe('observed widget VisualSkin projection', () => {
    it('preserves transparent and opaque captured paint as authoritative state', () => {
        const source: ObservedDomNode = {
            sourceId: 'root', tagName: 'main', computedStyle: { display: 'flex' },
            rect: { x: 0, y: 0, width: 300, height: 40 },
            children: [button('ghost', 'rgba(0, 0, 0, 0)'), button('selected', 'rgb(28, 78, 72)', true)],
        };
        const lowered = lowerObservedDom(source, '2026-07-11T00:00:00Z');
        expect(lowered.children[0].paint?.backgroundColor).toBe('#00000000');
        const native = toNativeDesignIrV1(lowered, { sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z' });
        const children = (native.root.children as Array<Record<string, any>>);
        expect(children[0].visualSkin.states.rest).toMatchObject({
            background: { r: 0, g: 0, b: 0, a: 0 }, foreground: { r: 230, g: 235, b: 240, a: 255 },
            borderWidth: 1, cornerRadius: 8, fontSize: 13, fontWeight: 600,
            lineHeight: 16, letterSpacing: 0, textAlign: 1, insetHorizontal: 10, insetVertical: 4,
        });
        expect(children[0].visualSkin.states.hover.background).toEqual({ r: 42, g: 52, b: 64, a: 204 });
        expect(children[1]).toMatchObject({ type: 'toggle_button' });
        expect(children[1].visualSkin.states.rest.background).toEqual({ r: 28, g: 78, b: 72, a: 255 });
        expect(children[0].style.backgroundColor).toBe('#00000000');
    });

    it('preserves a uniform computed longhand radius in every captured control state', () => {
        const source = button('pill', 'rgb(255, 255, 255)');
        delete source.computedStyle!.borderRadius;
        Object.assign(source.computedStyle!, {
            borderTopLeftRadius: '7.5px', borderTopRightRadius: '7.5px',
            borderBottomRightRadius: '7.5px', borderBottomLeftRadius: '7.5px',
        });
        source.stateStyles = {
            rest: {
                borderTopLeftRadius: '7.5px', borderTopRightRadius: '7.5px',
                borderBottomRightRadius: '7.5px', borderBottomLeftRadius: '7.5px',
            },
            hover: {
                backgroundColor: 'rgb(245, 245, 245)',
                borderTopLeftRadius: '9px', borderTopRightRadius: '9px',
                borderBottomRightRadius: '9px', borderBottomLeftRadius: '9px',
            },
            pressed: {
                borderTopLeftRadius: '10px', borderTopRightRadius: '10px',
                borderBottomRightRadius: '10px', borderBottomLeftRadius: '10px',
            },
            disabled: {
                borderTopLeftRadius: '9999px', borderTopRightRadius: '9999px',
                borderBottomRightRadius: '9999px', borderBottomLeftRadius: '9999px',
            },
        };

        const lowered = lowerObservedDom(source, '2026-07-11T00:00:00Z');
        const native = toNativeDesignIrV1(lowered, {
            sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z',
        });
        expect((native.root as Record<string, any>).visualSkin.states.rest.cornerRadius).toBe(7.5);
        expect((native.root as Record<string, any>).visualSkin.states.hover.cornerRadius).toBe(9);
        expect((native.root as Record<string, any>).visualSkin.states.pressed.cornerRadius).toBe(10);
        expect((native.root as Record<string, any>).visualSkin.states.disabled.cornerRadius).toBe(9999);
    });

    it('keeps percentage pill radii responsive in rest and captured states', () => {
        const source = button('responsive-pill', 'rgb(255, 255, 255)');
        source.computedStyle!.borderRadius = '50%';
        source.stateStyles = {
            hover: { borderRadius: '40%' },
            pressed: { backgroundColor: 'rgb(230, 230, 230)' },
            disabled: { borderRadius: '25%' },
        };
        const lowered = lowerObservedDom(source, '2026-07-11T00:00:00Z');
        expect(lowered.paint?.borderRadius).toBe('50%');
        const native = toNativeDesignIrV1(lowered, {
            sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z',
        }) as { root: Record<string, any> };
        expect(native.root.style.borderRadius).toBeUndefined();
        expect(native.root.visualSkin.states.rest.cornerRadiusPercent).toBe(50);
        expect(native.root.visualSkin.states.hover.cornerRadiusPercent).toBe(40);
        expect(native.root.visualSkin.states.pressed.cornerRadiusPercent).toBeUndefined();
        expect(native.root.visualSkin.states.disabled.cornerRadiusPercent).toBe(25);
    });

    it('preserves asymmetric longhand corners in a promoted control skin', () => {
        const source = button('asymmetric', 'rgb(255, 255, 255)');
        delete source.computedStyle!.borderRadius;
        Object.assign(source.computedStyle!, {
            borderTopLeftRadius: '8px', borderTopRightRadius: '8px',
            borderBottomRightRadius: '2px', borderBottomLeftRadius: '2px',
        });
        const lowered = lowerObservedDom(source, '2026-07-11T00:00:00Z');
        const native = toNativeDesignIrV1(lowered, {
            sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z',
        });
        const rest = (native.root as Record<string, any>).visualSkin.states.rest;
        expect(rest.cornerRadius).toBeUndefined();
        expect(rest).toMatchObject({
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            borderBottomRightRadius: 2,
            borderBottomLeftRadius: 2,
        });
    });

    it('preserves asymmetric percentage corners for paint-time resolution', () => {
        const source = button('asymmetric percent', 'rgb(255, 255, 255)');
        delete source.computedStyle!.borderRadius;
        Object.assign(source.computedStyle!, {
            borderTopLeftRadius: '50%', borderTopRightRadius: '25%',
            borderBottomRightRadius: '10%', borderBottomLeftRadius: '5%',
            cornerShape: 'superellipse(1.5)',
        });
        const native = toNativeDesignIrV1(
            lowerObservedDom(source, '2026-07-11T00:00:00Z'), {
                sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z',
            });
        expect((native.root as Record<string, any>).visualSkin.states.rest).toMatchObject({
            borderTopLeftRadiusPercent: 50,
            borderTopRightRadiusPercent: 25,
            borderBottomRightRadiusPercent: 10,
            borderBottomLeftRadiusPercent: 5,
            borderCurve: 'continuous',
        });
    });
});
