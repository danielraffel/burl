import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed text color route', () => {
    it('normalizes every observed CSS Color 4 value exactly', () => {
        const cases = [
            ['oklab(0.754013 0.0000343323 0.0000150204 / 0.2)', '#afafaf33'],
            ['oklab(0.754013 0.0000343323 0.0000150204 / 0.3)', '#afafaf4d'],
            ['oklab(0.754013 0.0000343323 0.0000150204 / 0.4)', '#afafaf66'],
            ['oklab(0.754013 0.0000343323 0.0000150204 / 0.6)', '#afafaf99'],
            ['oklab(0.754013 0.0000343323 0.0000150204 / 0.7)', '#afafafb3'],
            ['oklab(0.999994 0.0000455677 0.0000200868 / 0.7)', '#ffffffb3'],
            ['oklch(0.637 0.237 25.331)', '#fb2c36ff'],
            ['oklch(0.723 0.219 149.579)', '#00c950ff'],
            ['oklch(0.795 0.184 86.047)', '#f0b100ff'],
            ['rgb(13, 13, 13)', '#0d0d0dff'], ['rgb(175, 175, 175)', '#afafafff'],
            ['rgb(255, 255, 255)', '#ffffffff'], ['rgba(0, 0, 0, 0)', '#00000000'],
        ] as const;
        for (const [color, expected] of cases) {
            const observed: ObservedDomNode = { sourceId: color, tagName: 'span', text: 'Text',
                computedStyle: { display: 'inline', color }, rect: { x: 0, y: 0, width: 40, height: 20 }, children: [] };
            const typed = lowerObservedDom(observed, 'now');
            expect(typed.paint?.color).toBe(expected);
            expect(toNativeDesignIrV1(typed, { sourceFile: '/color', importedAt: 'now' }).root.style?.color).toBe(expected);
        }
    });
});
