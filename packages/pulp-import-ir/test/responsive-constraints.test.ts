import { describe, expect, test } from 'vitest';
import { reconcileResponsiveConstraints } from '../src/responsive-constraints.js';
import type { ObservedDomNode } from '../src/adapters/observed-dom/lower.js';

const node = (sourceId: string, width: number, height: number, children: ObservedDomNode[] = [], style: Record<string, string> = {}): ObservedDomNode => ({
    sourceId, tagName: 'div', attributes: {}, computedStyle: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', ...style },
    rect: { x: 0, y: 0, width, height }, children,
});

describe('multi-viewport constraint reconciliation', () => {
    test('infers fixed, fill, proportional and visibility breakpoint models', () => {
        const capture = (viewport: number) => {
            const hidden = viewport < 700;
            return {
                viewport: { width: viewport, height: 600 },
                root: node('root', viewport, 600, [
                    node('fixed', 200, 40),
                    node('fill', viewport - 40, 50),
                    node('half', viewport * 0.5, 60),
                    node('sidebar', hidden ? 0 : 240, hidden ? 0 : 600, [], { display: hidden ? 'none' : 'flex' }),
                ]),
            };
        };
        const result = reconcileResponsiveConstraints([capture(640), capture(800), capture(1200)]);
        expect(result.constraints.get('fixed')?.horizontal.kind).toBe('fixed');
        expect(result.constraints.get('fill')?.horizontal).toMatchObject({ kind: 'fill', offset: -40 });
        expect(result.constraints.get('half')?.horizontal).toMatchObject({ kind: 'proportional', ratio: 0.5 });
        expect(result.constraints.get('sidebar')?.visibility).toEqual([
            { visible: false, structural: false, transitionToNext: { lowerBound: 640, upperBound: 800, confidence: 'bounded' } },
            { visible: true, structural: false },
        ]);
        expect(result.diagnostics).toContainEqual(expect.objectContaining({ sourceId: 'sidebar', code: 'bounded-breakpoint' }));
    });

    test('models monotonic conditional rendering as a bounded structural variant', () => {
        const wide = { viewport: { width: 1000, height: 600 }, root: node('root', 1000, 600, [node('conditional', 100, 20)]) };
        const mid = { viewport: { width: 800, height: 600 }, root: node('root', 800, 600) };
        const small = { viewport: { width: 600, height: 600 }, root: node('root', 600, 600) };
        const result = reconcileResponsiveConstraints([wide, mid, small]);
        expect(result.constraints.get('conditional')?.visibility).toEqual([
            { visible: false, structural: true, transitionToNext: { lowerBound: 800, upperBound: 1000, confidence: 'bounded' } },
            { visible: true, structural: false },
        ]);
        expect(result.matchReport.structuralVariants).toBe(1);
        expect(result.diagnostics).toContainEqual(expect.objectContaining({ sourceId: 'conditional', code: 'bounded-breakpoint' }));
    });
});
