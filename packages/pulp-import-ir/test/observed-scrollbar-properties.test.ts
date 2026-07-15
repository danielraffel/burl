import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function lower(computedStyle: Record<string, string>, tagName = 'div',
               scrollGeometry?: ObservedDomNode['scrollGeometry']) {
    const observed: ObservedDomNode = {
        sourceId: 'scroll-owner', tagName,
        computedStyle: { display: 'block', overflowX: 'hidden', overflowY: 'auto', ...computedStyle },
        rect: { x: 0, y: 0, width: 100, height: 40 }, children: [], scrollGeometry,
    };
    const typed = lowerObservedDom(observed, 'now');
    if (tagName === 'ScrollView') typed.tag = 'ScrollView';
    const native = toNativeDesignIrV1(typed, { sourceFile: '/scrollbar', importedAt: 'now' });
    return { typed, native };
}

describe('observed scrollbar properties', () => {
    it('promotes an ordinary overflowing DOM node from runtime axis and extent evidence', () => {
        const { typed, native } = lower({}, 'div', {
            clientWidth: 100, clientHeight: 40, scrollWidth: 100, scrollHeight: 160, scrollLeft: 0, scrollTop: 0,
        });
        expect(typed.tag).toBe('ScrollView');
        expect(typed.layout).toMatchObject({
            overflowX: 'hidden', overflowY: 'auto',
            scrollContentWidth: 100, scrollContentHeight: 160,
        });
        expect(typed.meta?.observed_scroll_promotion).toMatchObject({
            direction: 'vertical', clientWidth: 100, clientHeight: 40,
            contentWidth: 100, contentHeight: 160,
        });
        expect(native.root.type).toBe('scroll_view');
        expect(native.root.layout).toMatchObject({
            scrollContentWidth: 100, scrollContentHeight: 160,
        });
    });

    it('keeps ambiguous scroll candidates as Views with named diagnostics', () => {
        const missing = lower({}, 'div').typed;
        expect(missing.tag).toBe('View');
        expect(missing.confidence).toBe('DIVERGE');
        expect(missing.meta?.observed_scroll_diagnostics).toEqual([{
            code: 'observed-scroll-geometry-missing', property: 'scrollGeometry', value: '<missing>',
        }]);

        const invalid = lower({}, 'div', {
            clientWidth: 100, clientHeight: 40, scrollWidth: 90, scrollHeight: 160, scrollLeft: 0, scrollTop: 0,
        }).typed;
        expect(invalid.tag).toBe('View');
        expect(invalid.meta?.observed_scroll_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'observed-scroll-geometry-invalid' }),
        ]));

        const offset = lower({}, 'div', {
            clientWidth: 100, clientHeight: 40, scrollWidth: 100, scrollHeight: 160,
            scrollLeft: 0, scrollTop: 20,
        }).typed;
        expect(offset.tag).toBe('View');
        expect(offset.meta?.observed_scroll_diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'observed-scroll-offset-unsupported' }),
        ]));
    });

    it('does not invent a native scroll owner when auto has no active extent', () => {
        const { typed } = lower({}, 'div', {
            clientWidth: 100, clientHeight: 40, scrollWidth: 100, scrollHeight: 40, scrollLeft: 0, scrollTop: 0,
        });
        expect(typed.tag).toBe('View');
        expect(typed.meta?.observed_scroll_diagnostics).toBeUndefined();
    });

    it('preserves the width policy and CSS thumb/track order through native style', () => {
        const { typed, native } = lower({
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgb(10, 20, 30) rgba(40, 50, 60, 0.5)',
        }, 'ScrollView');
        expect(typed.paint).toMatchObject({
            scrollbarWidth: 'thin',
            scrollbarThumbColor: '#0a141eff',
            scrollbarTrackColor: '#28323c80',
        });
        expect(native.root.style).toMatchObject({
            scrollbarWidth: 'thin',
            scrollbarThumbColor: '#0a141eff',
            scrollbarTrackColor: '#28323c80',
        });
        expect(native.root.visualSkin.states.rest).toMatchObject({
            scrollbarThumb: { r: 10, g: 20, b: 30, a: 255 },
            scrollbarTrack: { r: 40, g: 50, b: 60, a: 128 },
        });
    });

    it('preserves none and leaves computed auto colors absent', () => {
        const { typed } = lower({ scrollbarWidth: 'none', scrollbarColor: 'auto' });
        expect(typed.paint?.scrollbarWidth).toBe('none');
        expect(typed.paint?.scrollbarThumbColor).toBeUndefined();
        expect(typed.paint?.scrollbarTrackColor).toBeUndefined();
    });

    it('fails closed with explicit diagnostics for unsupported policy or color syntax', () => {
        const { typed } = lower({ scrollbarWidth: '12px', scrollbarColor: 'red' });
        expect(typed.paint?.scrollbarWidth).toBeUndefined();
        expect(typed.paint?.scrollbarThumbColor).toBeUndefined();
        expect(typed.meta?.observed_style_diagnostics).toEqual(expect.arrayContaining([
            { property: 'scrollbarWidth', value: '12px', code: 'css-scrollbar-width-unsupported' },
            { property: 'scrollbarColor', value: 'red', code: 'css-scrollbar-color-unsupported' },
        ]));
    });
});
