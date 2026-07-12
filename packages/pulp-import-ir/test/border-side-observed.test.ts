import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed per-side border route', () => {
    it('preserves side-specific CSS Color 4 paint in native style', () => {
        const observed: ObservedDomNode = {
            sourceId: 'side', tagName: 'div', computedStyle: {
                display: 'block', borderBottomWidth: '1px',
                borderBottomColor: 'oklab(0.301182 0.0000137091 0.00000602007 / 0.6)',
            }, rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
        };
        const typed = lowerObservedDom(observed, 'now');
        expect(typed.paint?.borderBottomWidth).toBe(1);
        expect(typed.paint?.borderBottomColor).toBe('#2e2e2e99');
        const native = toNativeDesignIrV1(typed, { sourceFile: '/side', importedAt: 'now' });
        expect(native.root.style?.borderBottomWidth).toBe(1);
        expect(native.root.style?.borderBottomColor).toBe('#2e2e2e99');
    });

    it('preserves an explicit zero bottom width as no-stroke identity', () => {
        const observed: ObservedDomNode = {
            sourceId: 'side-zero', tagName: 'div', computedStyle: {
                display: 'block', borderBottomWidth: '0px', borderBottomColor: 'rgb(46, 46, 46)',
            }, rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
        };
        const typed = lowerObservedDom(observed, 'now');
        expect(typed.paint?.borderBottomWidth).toBe(0);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/side-zero', importedAt: 'now' });
        expect(native.root.style?.borderBottomWidth).toBe(0);
    });

    it('normalizes and preserves observed left-side color equivalence classes', () => {
        const cases = [
            ['oklab(0.301182 0.0000137091 0.00000602007 / 0.6)', '#2e2e2e99'],
            ['rgb(175, 175, 175)', '#afafafff'],
            ['rgb(46, 46, 46)', '#2e2e2eff'],
            ['rgba(0, 0, 0, 0)', '#00000000'],
        ] as const;
        for (const [color, expected] of cases) {
            const observed: ObservedDomNode = {
                sourceId: `left-${expected}`, tagName: 'div', computedStyle: {
                    display: 'block', borderLeftWidth: '1px', borderLeftColor: color,
                }, rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
            };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.paint?.borderLeftWidth).toBe(1);
            expect(typed.paint?.borderLeftColor).toBe(expected);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/left', importedAt: 'now' });
            expect(native.root.style?.borderLeftWidth).toBe(1);
            expect(native.root.style?.borderLeftColor).toBe(expected);
        }
    });

    it('preserves explicit zero left width as no-stroke identity', () => {
        const observed: ObservedDomNode = {
            sourceId: 'left-zero', tagName: 'div', computedStyle: {
                display: 'block', borderLeftWidth: '0px', borderLeftColor: 'rgb(46, 46, 46)',
            }, rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
        };
        const typed = lowerObservedDom(observed, 'now');
        expect(typed.paint?.borderLeftWidth).toBe(0);
        const native = toNativeDesignIrV1(typed, { sourceFile: '/left-zero', importedAt: 'now' });
        expect(native.root.style?.borderLeftWidth).toBe(0);
    });
});
