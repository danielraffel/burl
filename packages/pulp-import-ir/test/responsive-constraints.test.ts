import { describe, expect, test } from 'vitest';
import { alignStableObservedDomIdentities, alignStableObservedDomIdentitiesWithReport, reconcileResponsiveConstraints, unionResponsiveTrees } from '../src/responsive-constraints.js';
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
        expect(result.constraints.get('fixed')?.horizontal?.kind).toBe('fixed');
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
        expect(union.children.map((child) => child.source_node_id)).toEqual(['expanded', 'compact']);
        expect(union.children[1].responsive?.visibility).toEqual([
            { visible: true, structural: false, transitionToNext: { lowerBound: 699, upperBound: 700, confidence: 'measured' } },
            { visible: false, structural: true },
        ]);
        expect(union.children[0].responsive?.visibility).toEqual([
            { visible: false, structural: true, transitionToNext: { lowerBound: 699, upperBound: 700, confidence: 'measured' } },
            { visible: true, structural: false },
        ]);
    });

    test('records structural child order at the exact sidebar breakpoint', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, viewport < 768
                ? [node('main', viewport, 600), node('toggle', 20, 20)]
                : [node('sidebar', 280, 600), node('main', viewport - 280, 600), node('toggle', 20, 20)]),
        });
        const captures = [capture(767), capture(768), capture(1200)];
        const reconciliation = reconcileResponsiveConstraints(captures);
        expect(reconciliation.constraints.get('root')?.layoutVariants).toEqual([
            { childOrder: ['main', 'toggle'], flexDirection: 'row', flexWrap: 'nowrap', reflowed: false,
                transitionToNext: { lowerBound: 767, upperBound: 768, confidence: 'measured' } },
            { childOrder: ['sidebar', 'main', 'toggle'], flexDirection: 'row', flexWrap: 'nowrap', reflowed: false },
        ]);
        const union = unionResponsiveTrees(captures.map((item) => lowerObservedDom(item.root, 'now')), reconciliation);
        expect(union.children.map((child) => child.source_node_id)).toEqual(['sidebar', 'main', 'toggle']);
    });

    test('segments child geometry at exact structural breakpoints', () => {
        const capture = (viewport: number) => {
            const wide = viewport >= 768;
            const mainWidth = wide ? viewport - 292 : viewport - 24;
            return {
                viewport: { width: viewport, height: 600 },
                root: node('root', viewport, 600, wide
                    ? [node('sidebar', 280, 600), node('main', mainWidth, 600)]
                    : [node('main', mainWidth, 600)]),
            };
        };
        const result = reconcileResponsiveConstraints([capture(599), capture(767), capture(768), capture(1200)]);
        expect(result.constraints.get('main')?.horizontalVariants).toEqual([
            { constraint: expect.objectContaining({ kind: 'fill', offset: -24 }),
                transitionToNext: { lowerBound: 767, upperBound: 768, confidence: 'measured' } },
            { constraint: expect.objectContaining({ kind: 'fill', offset: -292 }) },
        ]);
    });

    test('does not freeze a fluid terminal segment sampled only at W and W+1', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, [
                node('main', viewport >= 768 ? viewport - 292 : viewport - 24, 600),
                ...(viewport >= 1024 ? [node('unrelated-breakpoint-child', 20, 20)] : []),
            ]),
        });
        const result = reconcileResponsiveConstraints([
            capture(767), capture(768), capture(769), capture(1023), capture(1024), capture(1025),
        ]);
        expect(result.constraints.get('main')?.horizontalVariants?.at(-1)?.constraint)
            .toMatchObject({ kind: 'fill', offset: -292, residual: 0 });
    });

    test('retains an exact horizontal model when the vertical axis is ambiguous', () => {
        const heights = [100, 140, 103, 177];
        const captures = [599, 767, 768, 1200].map((viewport, index) => ({
            viewport: { width: viewport, height: 800 },
            root: node('root', viewport, 800, [node('content', viewport - 24, heights[index])]),
        }));
        const result = reconcileResponsiveConstraints(captures);
        expect(result.constraints.get('content')?.horizontal).toMatchObject({ kind: 'fill', offset: -24 });
        expect(result.constraints.get('content')?.vertical).toBeUndefined();
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            sourceId: 'content', code: 'ambiguous-axis', message: expect.stringContaining('vertical:'),
        }));
    });

    test('aligns path index drift under a stable source attribute', () => {
        const narrow = node('root', 599, 600, [node('root/main[content]:1', 599, 600)]);
        narrow.children[0].attributes['data-slot'] = 'content';
        const wide = node('root', 1200, 600, [node('root/aside:1', 240, 600), node('root/main[content]:2', 960, 600)]);
        wide.children[1].attributes['data-slot'] = 'content';
        const aligned = alignStableObservedDomIdentities([
            { viewport: { width: 599, height: 600 }, root: narrow },
            { viewport: { width: 1200, height: 600 }, root: wide },
        ]);
        expect(aligned[0].root.children[0].sourceId).toBe('root/main[content]:2');
    });

    test('merges one stable node across every width without an index duplicate', () => {
        const capture = (width: number, prefix: boolean) => {
            const content = node(`root/main[content]:${prefix ? 2 : 1}`, width - (prefix ? 240 : 0), 600);
            content.attributes['data-slot'] = 'content';
            return { viewport: { width, height: 600 }, root: node('root', width, 600,
                prefix ? [node('root/aside:1', 240, 600), content] : [content]) };
        };
        const aligned = alignStableObservedDomIdentities([
            capture(599, false), capture(768, true), capture(1200, true),
        ]);
        const ids = aligned.map(({ root }) => root.children.find((child) => child.attributes['data-slot'] === 'content')!.sourceId);
        expect(new Set(ids)).toEqual(new Set(['root/main[content]:2']));
        const result = reconcileResponsiveConstraints(aligned);
        expect(new Set(result.diagnostics.filter((item) => item.sourceId.includes('main[content]'))
            .map((item) => item.sourceId))).toEqual(new Set(['root/main[content]:2']));
    });

    test('preserves canonical repeated slots and reports ambiguous legacy collisions', () => {
        const item = (id: string) => {
            const value = node(id, 100, 20);
            value.attributes['data-slot'] = 'sidebar-menu-button';
            return value;
        };
        const canonical = alignStableObservedDomIdentitiesWithReport([
            { viewport: { width: 600, height: 600 }, root: node('dom/root:0', 600, 600, [item('dom/root:0/item-a:0'), item('dom/root:0/item-b:0')]) },
            { viewport: { width: 1200, height: 600 }, root: node('dom/root:0', 1200, 600, [item('dom/root:0/item-b:0'), item('dom/root:0/item-a:0')]) },
        ]);
        expect(canonical.captures[0].root.children.map((child) => child.sourceId)).toEqual(['dom/root:0/item-a:0', 'dom/root:0/item-b:0']);
        expect(canonical.captures[1].root.children.map((child) => child.sourceId)).toEqual(['dom/root:0/item-b:0', 'dom/root:0/item-a:0']);
        expect(canonical.report.collisions).toBeGreaterThan(0);
        expect(canonical.report.refusedCollisions).toBe(canonical.report.collisions);
        expect(canonical.report.collisionCategories['data-slot']).toBe(canonical.report.collisions);

        const legacy = alignStableObservedDomIdentitiesWithReport([
            { viewport: { width: 600, height: 600 }, root: node('root', 600, 600, [item('root/button:1'), item('root/button:2')]) },
            { viewport: { width: 1200, height: 600 }, root: node('root', 1200, 600, [item('root/button:2'), item('root/button:3')]) },
        ]);
        expect(legacy.captures[0].root.children.map((child) => child.sourceId)).toEqual(['root/button:1', 'root/button:2']);
        expect(legacy.report.aligned).toBe(0);
        expect(legacy.report.collisions).toBeGreaterThanOrEqual(4);
        expect(legacy.report.refusedCollisions).toBe(legacy.report.collisions);
    });
});
