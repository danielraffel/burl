import { describe, expect, test } from 'vitest';
import { composeResponsiveApplicationStateLayers } from '../src/compose-responsive-application-state-layers.js';

const responsive = (width: number, structural = false) => ({
    horizontal: { kind: 'fixed' as const, value: width, residual: 0 },
    visibility: [{ visible: true, structural }], layoutVariants: [], sampledViewports: [600, 1200],
});
const node = (id: string, children: any[] = [], extras: any = {}) => ({
    tag: 'frame', stable_anchor_id: id, source_node_id: id, children,
    provenance: { source: 'test' }, raw_source: {}, confidence: 'exact', ...extras,
});
const owner = (id: string, key: string, value: string, children: any[] = [], when: any[] = []) =>
    node(id, children, { responsive: { visibility: [], layoutVariants: [], sampledViewports: [],
        applicationStateKey: key, visibilityByApplicationState: { [value]: true },
        ...(when.length ? { applicationStateWhen: when } : {}) } });

describe('responsive application-state layer composition', () => {
    test('selects same source identity by owner value before projection', () => {
        const base = node('root', [owner('pane', 'panel.open', 'closed'), owner('pane', 'panel.open', 'open')]);
        const closed = node('root', [node('pane', [], { responsive: responsive(300) })]);
        const open = node('root', [node('pane', [], { responsive: responsive(500) })]);
        const result = composeResponsiveApplicationStateLayers(base, [{ key: 'panel.open', values: { closed, open } }]);
        expect(result.root.children.map((child: any) => child.responsive.horizontal.value)).toEqual([300, 500]);
        expect(result.report.projectedResponsiveRecordsByLayer).toEqual({
            'panel.open:closed': 1, 'panel.open:open': 1,
        });
    });

    test('selects a nested scoped owner without touching the unscoped sibling', () => {
        const scope = [{ key: 'navigation.route', value: 'settings' }];
        const base = node('root', [
            owner('pane', 'panel.open', 'closed'),
            owner('pane', 'panel.open', 'closed', [], scope),
            owner('pane', 'panel.open', 'open', [], scope),
        ]);
        const closed = node('root', [node('pane', [], { responsive: responsive(320) })]);
        const open = node('root', [node('pane', [], { responsive: responsive(640) })]);
        const result = composeResponsiveApplicationStateLayers(base, [
            { key: 'panel.open', when: scope, values: { closed, open } },
        ]);
        expect((result.root.children[0] as any).responsive.horizontal).toBeUndefined();
        expect(result.root.children.slice(1).map((child: any) => child.responsive.horizontal.value)).toEqual([320, 640]);
    });

    test('projects a scalar state patch when a shared frontier has different responsive geometry', () => {
        const rect = (width: number) => ({ node: { rect: { x: width === 920 ? 280 : 12,
            y: 0, width, height: 800 } } });
        const base = node('root', [owner('route-chat', 'route', 'chat', [node('main', [node('action', [], {
            attributes: { pulpHostAction: 'session.create' },
        })], { raw_source: rect(920), responsive: { visibility: [], layoutVariants: [], sampledViewports: [],
            applicationStateVariants: [{ key: 'sidebar.open', value: 'closed',
                when: [{ key: 'route', value: 'chat' }], layout: { paddingLeft: '160' } }] } })])]);
        const closed = node('root', [node('main', [node('action')], {
            raw_source: rect(1188), responsive: { ...responsive(1188),
                horizontal: { kind: 'fill', offset: -12, residual: 0 },
                layoutVariants: [{ computedStyleLiterals: { paddingLeft: '160px' } }] } })]);
        const open = node('root', [node('main', [node('action')], {
            raw_source: rect(920), responsive: { ...responsive(920),
                horizontal: { kind: 'fill', offset: -280, residual: 0 } } })]);
        const result = composeResponsiveApplicationStateLayers(base, [{
            key: 'sidebar.open', values: { closed, open },
            whenByValue: { closed: [{ key: 'route', value: 'chat' }], open: [] },
        }]);
        const main: any = result.root.children[0]!.children[0]!;
        expect(main.responsive.horizontal).toEqual({ kind: 'fill', offset: -280, residual: 0 });
        expect(main.responsive.applicationStateVariants).toEqual([{
            key: 'sidebar.open', value: 'closed', when: [{ key: 'route', value: 'chat' }],
            layout: { paddingLeft: '160px', width: 'calc(100% - 12px)' },
        }]);
        expect(main.children[0].attributes.pulpHostAction).toBe('session.create');
        expect(result.report.insertedStateResponsiveBranches).toBe(0);
        expect(result.report.projectedStateResponsivePatches).toBe(1);
    });

    test('confines a candidate-only structural child to its selected owner frontier', () => {
        const base = node('root', [owner('pane', 'panel.open', 'closed'), owner('pane', 'panel.open', 'open')]);
        const closed = node('root', [node('pane')]);
        const open = node('root', [node('pane', [node('sheet', [], { responsive: responsive(280, true) })])]);
        const result = composeResponsiveApplicationStateLayers(base, [{ key: 'panel.open', values: { closed, open } }]);
        expect(result.root.children[0].children).toHaveLength(0);
        expect(result.root.children[1].children.map((child) => child.source_node_id)).toEqual(['sheet']);
        expect((result.root.children[1].children[0] as any).responsive.applicationStateKey).toBeUndefined();
    });

    test('accepts a state frontier represented by proven source absence', () => {
        const base = node('root', [owner('sheet', 'panel.open', 'open')]);
        const closed = node('root', [node('content', [], { responsive: responsive(600) })]);
        const open = node('root', [node('content', [], { responsive: responsive(320) }),
            node('sheet', [], { responsive: responsive(280) })]);
        const result = composeResponsiveApplicationStateLayers(base, [
            { key: 'panel.open', values: { closed, open } },
        ]);
        expect(result.report.matchedFrontiers['panel.open:open']).toBe(1);
        expect(result.report.matchedFrontiers['panel.open:closed']).toBeUndefined();
        expect(result.report.matchedAbsentFrontiers).toEqual({ 'panel.open:closed': 1 });
    });

    test('rejects a missing owner when the source proves the frontier exists', () => {
        const base = node('root', [owner('sheet', 'panel.open', 'open')]);
        const closed = node('root', [node('sheet', [], { responsive: responsive(280) })]);
        const open = node('root', [node('sheet', [], { responsive: responsive(280) })]);
        expect(() => composeResponsiveApplicationStateLayers(base, [
            { key: 'panel.open', values: { closed, open } },
        ])).toThrow('panel.open:closed has no matching existing owner/value frontier');
    });

    test('is idempotent and preserves native assets and action payloads', () => {
        const action = { pulpHostAction: 'panel.toggle', pulpActionPayload: '{"value":true}',
            asset_id: 'inline-svg-deadbeef' };
        const base = node('root', [owner('pane', 'panel.open', 'closed', [], []),
            owner('pane', 'panel.open', 'open', [], [])], { attributes: action });
        const closed = node('root', [node('pane', [], { responsive: responsive(300) })]);
        const open = node('root', [node('pane', [], { responsive: responsive(500) })]);
        const dimension = [{ key: 'panel.open', values: { closed, open } }];
        const once = composeResponsiveApplicationStateLayers(base, dimension);
        const twice = composeResponsiveApplicationStateLayers(once.root, dimension);
        expect(twice.root).toEqual(once.root);
        expect((twice.root as any).attributes).toEqual(action);
        expect(twice.report.insertedStructuralNodes).toBe(0);
    });
});
