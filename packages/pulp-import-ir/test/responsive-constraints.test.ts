import { describe, expect, test } from 'vitest';
import { reconcileResponsiveConstraints, unionResponsiveTrees } from '../src/responsive-constraints.js';
import { lowerObservedDom } from '../src/adapters/observed-dom/lower.js';
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

    test('unions exact structural branches without viewport-history-dependent identity', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, viewport < 700
                ? [node('compact', viewport, 600)] : [node('expanded', viewport, 600)]),
        });
        const captures = [capture(699), capture(700), capture(701)];
        const reconciliation = reconcileResponsiveConstraints(captures);
        const union = unionResponsiveTrees(captures.map((item) => lowerObservedDom(item.root, '2026-01-01T00:00:00Z')), reconciliation);
        expect(union.children.map((child) => child.source_node_id)).toEqual(['compact', 'expanded']);
        expect(union.children[0].responsive?.visibility).toEqual([
            { visible: true, structural: false, transitionToNext: { lowerBound: 699, upperBound: 700, confidence: 'measured' } },
            { visible: false, structural: true },
        ]);
        expect(union.children[1].responsive?.visibility).toEqual([
            { visible: false, structural: true, transitionToNext: { lowerBound: 699, upperBound: 700, confidence: 'measured' } },
            { visible: true, structural: false },
        ]);
    });
});
