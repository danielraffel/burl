import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed per-side border route', () => {
    it('preserves every observed color and width across all physical sides', () => {
        const colors = [
            'oklab(0.301182 0.0000137091 0.00000602007 / 0.5)',
            'oklab(0.301182 0.0000137091 0.00000602007 / 0.6)',
            'oklab(0.754013 0.0000343323 0.0000150204 / 0.5)',
            'oklab(0.754013 0.0000343323 0.0000150204 / 0.3)',
            'oklab(0.769 0.0640531 0.176752 / 0.6)',
            'oklab(0.999994 0.0000455678 0.0000200868 / 0.05)',
            'rgb(175, 175, 175)',
            'rgb(46, 46, 46)',
            'rgba(0, 0, 0, 0)',
        ];
        const sides = [
            ['Top', 'borderTopWidth', 'borderTopColor'],
            ['Right', 'borderRightWidth', 'borderRightColor'],
            ['Bottom', 'borderBottomWidth', 'borderBottomColor'],
            ['Left', 'borderLeftWidth', 'borderLeftColor'],
        ] as const;
        for (const [side, widthKey, colorKey] of sides) {
            for (const width of [0, 1, 2]) {
                for (const color of colors) {
                    const observed: ObservedDomNode = {
                        sourceId: `${side}-${width}-${color}`, tagName: 'div',
                        computedStyle: { display: 'block', [widthKey]: `${width}px`, [colorKey]: color },
                        rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
                    };
                    const typed = lowerObservedDom(observed, 'now');
                    const normalized = typed.paint?.[colorKey];
                    expect(typed.paint?.[widthKey]).toBe(width);
                    expect(normalized).toMatch(/^#[0-9a-f]{8}$/);
                    const native = toNativeDesignIrV1(typed, { sourceFile: '/side-family', importedAt: 'now' });
                    expect(native.root.style?.[widthKey]).toBe(width);
                    expect(native.root.style?.[colorKey]).toBe(normalized);
                }
            }
        }
    });

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

    it('normalizes and preserves observed right-side equivalence classes', () => {
        const cases = [
            ['oklab(0.301182 0.0000137091 0.00000602007 / 0.6)', '#2e2e2e99'],
            ['rgb(175, 175, 175)', '#afafafff'],
            ['rgb(46, 46, 46)', '#2e2e2eff'],
            ['rgba(0, 0, 0, 0)', '#00000000'],
        ] as const;
        for (const [color, expected] of cases) {
            const observed: ObservedDomNode = {
                sourceId: `right-${expected}`, tagName: 'div', computedStyle: {
                    display: 'block', borderRightWidth: '1px', borderRightColor: color,
                }, rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
            };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.paint?.borderRightWidth).toBe(1);
            expect(typed.paint?.borderRightColor).toBe(expected);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/right', importedAt: 'now' });
            expect(native.root.style?.borderRightWidth).toBe(1);
            expect(native.root.style?.borderRightColor).toBe(expected);
        }

        const zero = lowerObservedDom({ sourceId: 'right-zero', tagName: 'div',
            computedStyle: { display: 'block', borderRightWidth: '0px', borderRightColor: 'rgb(46, 46, 46)' },
            rect: { x: 0, y: 0, width: 100, height: 30 }, children: [] }, 'now');
        expect(zero.paint?.borderRightWidth).toBe(0);
        expect(toNativeDesignIrV1(zero, { sourceFile: '/right-zero', importedAt: 'now' })
            .root.style?.borderRightWidth).toBe(0);
    });

    it('normalizes and preserves observed top-side equivalence classes', () => {
        const cases = [
            ['oklab(0.301182 0.0000137091 0.00000602007 / 0.6)', '#2e2e2e99'],
            ['rgb(175, 175, 175)', '#afafafff'],
            ['rgb(46, 46, 46)', '#2e2e2eff'],
            ['rgba(0, 0, 0, 0)', '#00000000'],
        ] as const;
        for (const [color, expected] of cases) {
            const observed: ObservedDomNode = {
                sourceId: `top-${expected}`, tagName: 'div', computedStyle: {
                    display: 'block', borderTopWidth: '1px', borderTopColor: color,
                }, rect: { x: 0, y: 0, width: 100, height: 30 }, children: [],
            };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.paint?.borderTopWidth).toBe(1);
            expect(typed.paint?.borderTopColor).toBe(expected);
            const native = toNativeDesignIrV1(typed, { sourceFile: '/top', importedAt: 'now' });
            expect(native.root.style?.borderTopWidth).toBe(1);
            expect(native.root.style?.borderTopColor).toBe(expected);
        }

        const zero = lowerObservedDom({ sourceId: 'top-zero', tagName: 'div',
            computedStyle: { display: 'block', borderTopWidth: '0px', borderTopColor: 'rgb(46, 46, 46)' },
            rect: { x: 0, y: 0, width: 100, height: 30 }, children: [] }, 'now');
        expect(zero.paint?.borderTopWidth).toBe(0);
        expect(toNativeDesignIrV1(zero, { sourceFile: '/top-zero', importedAt: 'now' })
            .root.style?.borderTopWidth).toBe(0);
    });
});
