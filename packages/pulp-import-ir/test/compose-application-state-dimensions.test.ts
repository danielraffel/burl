import { describe, expect, test } from 'vitest';
import { composeApplicationStateDimensions } from '../src/compose-application-state-dimensions.js';
import type { IRNode } from '../src/types.js';

const node = (id: string, children: IRNode[] = []): IRNode => ({
    stable_anchor_id: id, source_node_id: id, tag: 'div', children,
    confidence: { overall: 1, source: 'observed' },
});
const variant = (id: string, key: string, state: string, children: IRNode[] = [], paddingLeft?: number): IRNode => ({
    ...node(id, children), stable_anchor_id: `application-state:${state}::${id}`,
    ...(paddingLeft === undefined ? {} : { layout: { paddingLeft } }),
    responsive: { visibility: [{ visible: true, structural: true }], layoutVariants: [], sampledViewports: [],
        applicationStateKey: key, visibilityByApplicationState: { [state]: true } },
});

describe('protected application-state dimension composition', () => {
    test('rebases disjoint dimensions without duplicating their parents', () => {
        const base = node('root', [node('left', [node('menu')]), node('right', [node('panel')])]);
        base.children[0].children[0].layout = { paddingLeft: 0 }; base.children[1].children[0].layout = { paddingLeft: 0 };
        const menu = node('root', [node('left', [variant('menu', 'menu.open', 'closed', [], 0), variant('menu', 'menu.open', 'open', [], 4)]), node('right', [node('panel')])]);
        menu.children[0].children.forEach((child) => { child.interaction = { actionBindingId: 'menu.toggle' }; });
        const panel = node('root', [node('left', [node('menu')]), node('right', [variant('panel', 'panel.open', 'closed', [], 0), variant('panel', 'panel.open', 'open', [], 8)])]);
        const result = composeApplicationStateDimensions(base, [
            { key: 'menu.open', root: menu, requiredActions: ['menu.toggle'] },
            { key: 'panel.open', root: panel },
        ]);
        expect(result.root.children[0].children[0].responsive?.applicationStateVariants).toHaveLength(2);
        expect(result.root.children[0].children[0].interaction?.actionBindingId).toBe('menu.toggle');
        expect(result.root.children[1].children[0].responsive?.applicationStateVariants).toHaveLength(2);
        expect(result.report.composedNodes).toBe(5);
    });

    test('composes a nested dimension without Cartesian node replication', () => {
        const base = node('root', [node('panel', [node('menu')])]); base.children[0].layout = { paddingLeft: 0 }; base.children[0].children[0].layout = { paddingLeft: 0 };
        const outer = node('root', [variant('panel', 'panel.open', 'closed', [node('menu')], 0),
            variant('panel', 'panel.open', 'open', [node('menu')], 4)]);
        const inner = node('root', [node('panel', [variant('menu', 'menu.open', 'closed', [], 0), variant('menu', 'menu.open', 'open', [], 8)])]);
        const result = composeApplicationStateDimensions(base, [{ key: 'panel.open', root: outer }, { key: 'menu.open', root: inner }]);
        expect(result.root.children).toHaveLength(1);
        expect(result.root.children[0].responsive?.applicationStateVariants).toHaveLength(2);
        expect(result.root.children[0].children[0].responsive?.applicationStateVariants).toHaveLength(2);
        expect(result.report.maximumIdentityDuplication).toBe(1);
    });

    test('keeps independent state-only portal branches with reused ephemeral identities', () => {
        const base = node('root', [node('stable-host')]);
        base.children[0]!.layout = { paddingLeft: 0 };
        const first = node('root', [node('stable-host'), variant('portal', 'first.open', 'open', [node('first-action')])]);
        first.children[1]!.responsive!.visibilityByApplicationState = { closed: false, open: true };
        first.children[1]!.children[0]!.responsive = { visibility: [{ visible: true, structural: true }],
            layoutVariants: [], sampledViewports: [], applicationStateKey: 'first.open',
            visibilityByApplicationState: { closed: false, open: true } };
        first.children[1]!.children[0]!.interaction = { actionBindingId: 'first.dismiss' };
        const second = node('root', [
            variant('stable-host', 'second.open', 'closed', [], 0),
            variant('stable-host', 'second.open', 'open', [], 4),
            variant('portal', 'second.open', 'open', [node('second-action')]),
        ]);
        second.children[2]!.responsive!.visibilityByApplicationState = { open: true };
        second.children[2]!.children[0]!.interaction = { actionBindingId: 'second.dismiss' };

        const composed = composeApplicationStateDimensions(base, [
            { key: 'first.open', root: first, requiredActions: ['first.dismiss'] },
            { key: 'second.open', root: second, requiredActions: ['second.dismiss'] },
        ], { maxNodeGrowthRatio: 5 });

        const portals = composed.root.children.filter((child) => child.source_node_id === 'portal');
        expect(portals).toHaveLength(2);
        expect(portals.map((child) => child.responsive?.applicationStateKey))
            .toEqual(['first.open', 'second.open']);
        expect(portals.map((child) => child.responsive?.visibility[0]?.visible))
            .toEqual([false, false]);
        expect(portals[1]!.responsive?.visibilityByApplicationState)
            .toEqual({ closed: false, open: true });
        expect(portals[0]!.children[0]!.responsive?.applicationStateKey).toBeUndefined();
        expect(new Set(portals.map((child) => child.stable_anchor_id)).size).toBe(2);
        expect(portals[1]!.stable_anchor_id).toContain('application-state-instance:second.open:open:');
        expect(portals[0]!.children[0]!.stable_anchor_id)
            .not.toBe(portals[1]!.children[0]!.stable_anchor_id);
    });

    test('refreshes an existing state-only portal from the protected cohort', () => {
        const stale = variant('portal', 'metrics.open', 'open', [node('dialog')]);
        stale.responsive!.visibilityByApplicationState = { closed: false, open: true };
        stale.children[0]!.layout = { width: 200 };
        const fresh = variant('portal', 'metrics.open', 'open', [node('dialog')]);
        fresh.responsive!.visibilityByApplicationState = { closed: false, open: true };
        fresh.children[0]!.layout = { width: 256 };

        const composed = composeApplicationStateDimensions(node('root', [stale]), [{
            key: 'metrics.open', root: node('root', [fresh]),
        }]);

        expect(composed.root.children).toHaveLength(1);
        expect(composed.root.children[0]!.children[0]!.layout?.width).toBe(256);
        expect(composed.root.children[0]!.responsive?.visibility)
            .toEqual([{ visible: false, structural: true }]);
        expect(composed.root.children[0]!.responsive?.visibilityByApplicationState)
            .toEqual({ closed: false, open: true });
    });

    test('does not graft candidate-only portal topology from the default captured state', () => {
        const existing = variant('portal', 'first.open', 'open');
        existing.responsive!.visibilityByApplicationState = { closed: false, open: true };
        const captured = node('root', [
            variant('stable-host', 'second.open', 'closed', [], 0),
            variant('stable-host', 'second.open', 'open', [], 4),
            variant('portal', 'second.open', 'closed', [node('default-only-menu')]),
        ]);
        captured.children[2]!.responsive!.visibilityByApplicationState = { closed: true, open: false };

        const composed = composeApplicationStateDimensions(node('root', [node('stable-host'), existing]), [
            { key: 'second.open', root: captured },
        ]);

        expect(composed.root.children.filter((child) => child.source_node_id === 'portal'))
            .toHaveLength(1);
        expect(composed.root.children.some((child) => child.children.some((nested) =>
            nested.source_node_id === 'default-only-menu'))).toBe(false);
    });

    test('strips invariant portal content captured across every unrelated state', () => {
        const base = node('root', [node('stable-host')]);
        const closed = variant('portal', 'display.mode', 'default', [node('unrelated-menu')]);
        closed.responsive!.visibilityByApplicationState = { default: true, verbose: false };
        (closed as any).raw_source = { node: { attributes: { 'data-base-ui-portal': '' } } };
        const verbose = variant('portal', 'display.mode', 'verbose', [node('unrelated-menu')]);
        verbose.responsive!.visibilityByApplicationState = { default: false, verbose: true };
        (verbose as any).raw_source = { node: { attributes: { 'data-base-ui-portal': '' } } };
        const captured = node('root', [node('stable-host'), closed, verbose]);

        const composed = composeApplicationStateDimensions(base, [
            { key: 'display.mode', root: captured },
        ]);
        const sourceIds: string[] = [];
        const collect = (current: IRNode) => {
            sourceIds.push(current.source_node_id ?? '');
            current.children.forEach(collect);
        };
        collect(composed.root);
        expect(sourceIds).not.toContain('unrelated-menu');
    });

    test('does not compose an unscoped dimension inside a foreign state-owned portal', () => {
        const base = node('root', [node('stable-host')]);
        base.children[0]!.layout = { paddingLeft: 0 };
        const menu = node('root', [
            node('stable-host'),
            variant('portal', 'menu.open', 'open', [node('menu-item')]),
        ]);
        menu.children[1]!.responsive!.visibilityByApplicationState = { closed: false, open: true };

        // A later whole-tree capture happened while the menu portal was open.
        // Its descendant changed for an unrelated display-mode transition.
        // Without a declared applicability relationship, the later dimension
        // must not create a Cartesian display.mode copy inside menu.open.
        const display = node('root', [
            node('stable-host'),
            node('portal', [
                variant('menu-item', 'display.mode', 'verbose', [], 2),
                variant('menu-item', 'display.mode', 'default', [], 4),
            ]),
            variant('portal', 'display.mode', 'default', [node('stale-open-menu')]),
        ]);
        display.children[2]!.responsive!.visibilityByApplicationState = { default: true };

        const composed = composeApplicationStateDimensions(base, [
            { key: 'menu.open', root: menu },
            { key: 'display.mode', root: display },
        ], { maxNodeGrowthRatio: 4 });

        const portal = composed.root.children.find((child) => child.source_node_id === 'portal');
        expect(portal?.responsive?.applicationStateKey).toBe('menu.open');
        expect(portal?.children).toHaveLength(1);
        expect(portal?.children[0]!.responsive?.applicationStateVariants).toBeUndefined();
        expect(portal?.children[0]!.responsive?.applicationStateKey).toBeUndefined();
        expect(composed.root.children.filter((child) => child.source_node_id === 'portal')).toHaveLength(1);
    });

    test('projects captured actions through generated ancestry using an explicit semantic identity', () => {
        const baseAction = node('root/default-shape/button-semantic-open-diff:0');
        const base = node('root', [node('panel', [baseAction])]);
        base.children[0]!.layout = { paddingLeft: 0 };
        const capturedAction = node('root/changed-shape/button-semantic-open-diff:0');
        capturedAction.interaction = { actionBindingId: 'diff.open' };
        const captured = node('root', [
            variant('panel', 'panel.open', 'closed', [capturedAction], 0),
            variant('panel', 'panel.open', 'open', [structuredClone(capturedAction)], 4),
        ]);
        const result = composeApplicationStateDimensions(base, [
            { key: 'panel.open', root: captured, requiredActions: ['diff.open'] },
        ]);
        expect(result.root.children[0]!.children[0]!.interaction?.actionBindingId).toBe('diff.open');
    });

    test('projects a stable native route with an action promoted onto native attributes', () => {
        const baseAction = node('root/default-shape/button-semantic-open-diff:0');
        (baseAction as any).attributes = { role: 'button' };
        const base = node('root', [node('panel', [baseAction])]);
        base.children[0]!.layout = { paddingLeft: 0 };
        const capturedAction = node('root/changed-shape/button-semantic-open-diff:0');
        (capturedAction as any).attributes = { role: 'button', pulpHostAction: 'diff.open' };
        const captured = node('root', [
            variant('panel', 'panel.open', 'closed', [capturedAction], 0),
            variant('panel', 'panel.open', 'open', [structuredClone(capturedAction)], 4),
        ]);
        const result = composeApplicationStateDimensions(base, [
            { key: 'panel.open', root: captured, requiredActions: ['diff.open'] },
        ]);
        const attributes = (result.root.children[0]!.children[0] as any).attributes;
        expect(attributes.pulpHostAction).toBe('diff.open');
        expect(attributes.pulpRouteId).toBe('root/default-shape/button-semantic-open-diff:0');
    });

    test('projects protected state-transition semantics over a stale default action binding', () => {
        const baseAction = node('root/default-shape/button-semantic-open-metrics:0');
        (baseAction as any).attributes = { role: 'button', pulpHostAction: 'metrics.open',
            pulpStateKey: 'metrics.open', pulpStateTransition: 'toggle' };
        const base = node('root', [node('toolbar', [baseAction])]);
        base.children[0]!.layout = { paddingLeft: 0 };
        const capturedAction = node('root/changed-shape/button-semantic-open-metrics:0');
        (capturedAction as any).attributes = { role: 'button', pulpHostAction: 'metrics.open',
            pulpStateKey: 'metrics.open', pulpStateTransition: 'set:open',
            pulpPayloadContract: 'open' };
        const captured = node('root', [
            variant('toolbar', 'metrics.open', 'closed', [capturedAction], 0),
            variant('toolbar', 'metrics.open', 'open', [structuredClone(capturedAction)], 4),
        ]);

        const result = composeApplicationStateDimensions(base, [{
            key: 'metrics.open', root: captured, requiredActions: ['metrics.open'],
        }]);
        const attributes = (result.root.children[0]!.children[0] as any).attributes;
        expect(attributes.pulpStateKey).toBe('metrics.open');
        expect(attributes.pulpStateTransition).toBe('set:open');
        expect(attributes.pulpPayloadContract).toBe('open');
    });

    test('lowers different child topology to state-gated structural branches', () => {
        const base = node('root', [node('content', [node('chat')])]);
        base.children[0]!.layout = { paddingLeft: 0 };
        const setting = node('setting-action');
        setting.interaction = { actionBindingId: 'settings.select' };
        const captured = node('root', [
            variant('content', 'route', 'chat', [node('chat')], 0),
            variant('content', 'route', 'settings', [node('settings', [setting])], 0),
        ]);
        const result = composeApplicationStateDimensions(base, [
            { key: 'route', root: captured, requiredActions: ['settings.select'] },
        ]);
        const children = result.root.children[0]!.children;
        expect(children).toHaveLength(2);
        expect(children[0]!.responsive?.visibilityByApplicationState).toEqual({ chat: true, settings: false });
        expect(children[1]!.responsive?.visibilityByApplicationState).toEqual({ chat: false, settings: true });
        expect(children[0]!.responsive?.visibility).toEqual([{ visible: true, structural: true }]);
        expect(children[1]!.responsive?.visibility).toEqual([{ visible: false, structural: true }]);
    });

    test('preserves whole-route branch ownership instead of flattening route-specific layout', () => {
        const chat = node('app', [node('sidebar', [node('sessions')]), node('main', [node('transcript')])]);
        const base = node('body', [chat]);
        const capturedChat = variant('app', 'navigation.route', 'chat', [
            node('sidebar', [node('sessions')]), node('main', [node('transcript')]),
        ]);
        capturedChat.responsive!.visibilityByApplicationState = { chat: true, settings: false };
        const capturedSettings = variant('app', 'navigation.route', 'settings', [
            node('settings-sidebar', [node('settings-menu', [node('general'), node('servers')])]),
            node('settings-main', [node('settings-form', [node('appearance'), node('providers')])]),
        ]);
        capturedSettings.responsive!.visibilityByApplicationState = { chat: false, settings: true };
        const captured = node('body', [capturedChat, capturedSettings]);

        const result = composeApplicationStateDimensions(base, [{
            key: 'navigation.route', root: captured, preserveWholeTreeBranches: true,
        }]);

        expect(result.root.children).toHaveLength(2);
        expect(result.root.children[0]!.children.map(({ source_node_id }) => source_node_id))
            .toEqual(['sidebar', 'main']);
        expect(result.root.children[1]!.children.map(({ source_node_id }) => source_node_id))
            .toEqual(['settings-sidebar', 'settings-main']);
        expect(result.root.children[0]!.responsive?.visibilityByApplicationState)
            .toEqual({ chat: true, settings: false });
        expect(result.root.children[1]!.responsive?.visibilityByApplicationState)
            .toEqual({ chat: false, settings: true });
        expect(result.root.children[0]!.responsive?.visibility[0]?.visible).toBe(true);
        expect(result.root.children[1]!.responsive?.visibility[0]?.visible).toBe(false);
    });

    test('recomposes an existing whole-tree cohort without duplicating or replacing native branches', () => {
        const base = node('body', [node('app', [node('chat-v1')])]);
        const firstCapture = node('body', [
            variant('app', 'navigation.route', 'chat', [node('chat-v1')]),
            variant('app', 'navigation.route', 'settings', [node('settings-v1')]),
        ]);
        const first = composeApplicationStateDimensions(base, [{
            key: 'navigation.route', root: firstCapture, preserveWholeTreeBranches: true,
        }]);
        const refreshedCapture = node('body', [
            variant('app', 'navigation.route', 'chat', [node('chat-v2')]),
            variant('app', 'navigation.route', 'settings', [node('settings-v2')]),
        ]);
        const refreshed = composeApplicationStateDimensions(first.root, [{
            key: 'navigation.route', root: refreshedCapture, preserveWholeTreeBranches: true,
        }]);

        expect(refreshed.root.children).toHaveLength(2);
        expect(refreshed.root.children.map((branch) => branch.children[0]!.source_node_id))
            .toEqual(['chat-v1', 'settings-v1']);
        expect(refreshed.root.children.map((branch) =>
            Object.entries(branch.responsive?.visibilityByApplicationState ?? {})
            .find(([, visible]) => visible)?.[0])).toEqual(['chat', 'settings']);
    });

    test('refreshes whole-tree layout lowering while preserving native branch content', () => {
        const nativeAsset = node('asset');
        nativeAsset.paint = { image: { kind: 'asset', src: 'native://resolved' } } as any;
        const app = node('app', [nativeAsset]);
        app.layout = { display: 'block', flexDirection: 'row' };
        const base = node('body', [app]);

        const chat = variant('app', 'navigation.route', 'chat', [node('asset')]);
        chat.layout = { display: 'flex', flexDirection: 'column' };
        const settings = variant('app', 'navigation.route', 'settings', [node('settings')]);
        settings.layout = { display: 'flex', flexDirection: 'column' };
        const result = composeApplicationStateDimensions(base, [{
            key: 'navigation.route', root: node('body', [chat, settings]),
            preserveWholeTreeBranches: true, defaultValue: 'chat',
        }]);

        expect(result.root.children[0]!.layout).toMatchObject({ display: 'flex', flexDirection: 'column' });
        expect(result.root.children[0]!.children[0]!.paint)
            .toEqual({ image: { kind: 'asset', src: 'native://resolved' } });
    });

    test('excludes actionless viewport-covering window-drag infrastructure from a state branch', () => {
        const observed = (item: IRNode, rect: { x: number; y: number; width: number; height: number },
            computedStyle: Record<string, string> = {}, style = '') => {
            (item as any).raw_source = { node: { rect, attributes: { style } }, computedStyle };
            return item;
        };
        const rect = { x: 0, y: 0, width: 1200, height: 800 };
        const base = node('body', [observed(node('app', [node('content')]), rect)]);
        const dark = variant('app', 'theme', 'dark', [node('content')]);
        (dark as any).raw_source = { node: { rect, attributes: {} }, computedStyle: {} };
        const startup = observed(node('startup-overlay'), rect,
            { position: 'fixed' }, 'app-region: drag; pointer-events: auto;');
        const light = variant('app', 'theme', 'light', [node('content'), startup]);
        (light as any).raw_source = { node: { rect, attributes: {} }, computedStyle: {} };

        const result = composeApplicationStateDimensions(base, [{
            key: 'theme', root: node('body', [dark, light]), preserveWholeTreeBranches: true,
            defaultValue: 'dark',
        }]);
        expect(result.root.children[1]!.children.map(({ source_node_id }) => source_node_id))
            .toEqual(['content']);
    });

    test('preserves scoped whole-tree ownership beneath an outer route dimension', () => {
        const chat = variant('app', 'navigation.route', 'chat', [node('transcript')]);
        chat.responsive!.visibilityByApplicationState = { chat: true, settings: false };
        const settings = variant('app', 'navigation.route', 'settings', [
            node('settings-sidebar', [node('general'), node('servers')]),
            node('settings-main', [node('appearance', [node('theme-row'), node('opaque-row'), node('display-row')])]),
        ]);
        settings.responsive!.visibilityByApplicationState = { chat: false, settings: true };
        const base = node('body', [chat, settings]);

        const dark = variant('app', 'settings.theme', 'dark', [
            node('settings-sidebar', [node('general'), node('servers')]),
            node('settings-main', [node('appearance', [node('theme-row'), node('opaque-row'), node('display-row')])]),
        ]);
        dark.responsive!.visibilityByApplicationState = { dark: true, light: false };
        const light = variant('app', 'settings.theme', 'light', [
            node('settings-sidebar', [node('general'), node('servers')]),
            node('settings-main', [node('appearance', [node('theme-row'), node('opaque-row'), node('display-row')])]),
        ]);
        light.responsive!.visibilityByApplicationState = { dark: false, light: true };

        const portalDark = variant('theme-select-portal', 'settings.theme', 'dark', [node('dark-option')]);
        portalDark.responsive!.visibilityByApplicationState = { dark: true, light: false };
        const portalLight = variant('theme-select-portal', 'settings.theme', 'light', [node('light-option')]);
        portalLight.responsive!.visibilityByApplicationState = { dark: false, light: true };
        const result = composeApplicationStateDimensions(base, [{
            key: 'settings.theme', root: node('body', [dark, portalDark, light, portalLight]),
            when: [{ key: 'navigation.route', value: 'settings' }],
            preserveWholeTreeBranches: true,
            defaultValue: 'dark',
        }]);

        expect(result.root.children).toHaveLength(3);
        expect(result.root.children.some(({ source_node_id }) => source_node_id === 'theme-select-portal')).toBe(false);
        expect(result.root.children[0]!.responsive?.applicationStateKey).toBe('navigation.route');
        for (const branch of result.root.children.slice(1)) {
            expect(branch.responsive?.applicationStateKey).toBe('settings.theme');
            expect(branch.responsive?.applicationStateWhen)
                .toEqual([{ key: 'navigation.route', value: 'settings' }]);
            expect(branch.children[1]!.children[0]!.children.map(({ source_node_id }) => source_node_id))
                .toEqual(['theme-row', 'opaque-row', 'display-row']);
        }
    });

    test('does not reintroduce an outer branch represented by scoped whole-tree owners', () => {
        const chat = variant('app', 'navigation.route', 'chat', [node('transcript-v1')]);
        chat.responsive!.visibilityByApplicationState = { chat: true, settings: false };
        const staleThemeAction = node('settings.theme.select.light');
        (staleThemeAction as any).attributes = {
            role: 'button', pulpHostAction: 'settings.theme.select',
        };
        const settings = variant('app', 'navigation.route', 'settings', [
            node('settings-v1', [staleThemeAction]),
        ]);
        settings.responsive!.visibilityByApplicationState = { chat: false, settings: true };
        const base = node('body', [chat, settings]);
        const capturedThemeAction = () => {
            const action = node('settings.theme.select.light');
            (action as any).attributes = {
                role: 'button', pulpHostAction: 'settings.theme.select',
                pulpPayloadContract: 'light', pulpStateKey: 'settings.theme',
                pulpStateTransition: 'set:light',
            };
            return action;
        };
        const dark = variant('app', 'settings.theme', 'dark', [
            node('settings-dark', [capturedThemeAction()]),
        ]);
        dark.responsive!.visibilityByApplicationState = { dark: true, light: false };
        const light = variant('app', 'settings.theme', 'light', [
            node('settings-light', [capturedThemeAction()]),
        ]);
        light.responsive!.visibilityByApplicationState = { dark: false, light: true };
        const themed = composeApplicationStateDimensions(base, [{
            key: 'settings.theme', root: node('body', [dark, light]),
            when: [{ key: 'navigation.route', value: 'settings' }],
            preserveWholeTreeBranches: true, defaultValue: 'dark',
            requiredActions: ['settings.theme.select'],
        }]);
        const refreshedChat = variant('app', 'navigation.route', 'chat', [node('transcript-v2')]);
        refreshedChat.responsive!.visibilityByApplicationState = { chat: true, settings: false };
        const capturedSettings = variant('app', 'navigation.route', 'settings', [node('settings-captured')]);
        capturedSettings.responsive!.visibilityByApplicationState = { chat: false, settings: true };
        const recomposed = composeApplicationStateDimensions(themed.root, [{
            key: 'navigation.route', root: node('body', [refreshedChat, capturedSettings]),
            preserveWholeTreeBranches: true,
        }]);

        expect(recomposed.root.children).toHaveLength(3);
        expect(recomposed.root.children[0]!.children[0]!.source_node_id).toBe('transcript-v1');
        expect(recomposed.root.children.slice(1).map((branch) => branch.responsive?.applicationStateKey))
            .toEqual(['settings.theme', 'settings.theme']);
        for (const branch of recomposed.root.children.slice(1)) {
            expect(branch.responsive?.applicationStateWhen)
                .toEqual([{ key: 'navigation.route', value: 'settings' }]);
            const attributes = (branch.children[0]!.children[0] as any).attributes;
            expect(attributes).toMatchObject({
                pulpHostAction: 'settings.theme.select',
                pulpPayloadContract: 'light',
                pulpStateKey: 'settings.theme',
                pulpStateTransition: 'set:light',
            });
        }
    });

    test('finds independent disclosure frontiers beneath the same broad captured ancestor', () => {
        const base = node('root', [node('content', [node('first'), node('second')])]);
        const first = node('root', [
            variant('content', 'first.open', 'closed', [node('first'), node('second')]),
            variant('content', 'first.open', 'open', [node('first', [node('first-detail')]), node('second')]),
        ]);
        const second = node('root', [
            variant('content', 'second.open', 'closed', [node('first'), node('second')]),
            variant('content', 'second.open', 'open', [node('first'), node('second', [node('second-detail')])]),
        ]);
        const result = composeApplicationStateDimensions(base, [
            { key: 'first.open', root: first }, { key: 'second.open', root: second },
        ]);
        const content = result.root.children[0]!;
        expect(content.children[0]!.children[0]!.responsive?.applicationStateKey).toBe('first.open');
        expect(content.children[1]!.children[0]!.responsive?.applicationStateKey).toBe('second.open');
        expect(result.report.maximumIdentityDuplication).toBe(1);
    });

    test('does not attribute canonical children absent from every cohort state to that dimension', () => {
        const base = node('root', [node('content', [node('canonical-toolbar')])]);
        base.children[0]!.layout = { paddingLeft: 0 };
        const captured = node('root', [
            variant('content', 'sidebar.open', 'closed', [], 0),
            variant('content', 'sidebar.open', 'open', [], 8),
        ]);
        const result = composeApplicationStateDimensions(base, [
            { key: 'sidebar.open', root: captured },
        ]);
        expect(result.root.children[0]!.children.map(({ source_node_id }) => source_node_id))
            .toEqual(['canonical-toolbar']);
        expect(result.root.children[0]!.children[0]!.responsive?.applicationStateKey).toBeUndefined();
    });

    test('does not import an absent candidate-only target present in every protected state', () => {
        const base = node('root', [node('content')]);
        const captured = node('root', [node('content', [
            variant('ephemeral-portal', 'theme', 'dark'),
            variant('ephemeral-portal', 'theme', 'light'),
        ])]);
        const result = composeApplicationStateDimensions(base, [{ key: 'theme', root: captured }]);
        expect(result.root.children[0]!.children).toEqual([]);
        expect(result.report.composedNodes).toBe(2);
    });

    test('uses semantic shape and unique geometry to rebase generated-ID drift', () => {
        const observed = (item: IRNode, x: number, state?: string) => {
            (item as any).raw_source = { node: { attributes: { 'data-slot': 'item',
                    ...(state ? { 'data-state': state } : {}) },
                rect: { x, y: 0, width: 20, height: 20 } } };
            return item;
        };
        const first = observed(node('root/div-shape-default-a:0'), 0);
        const second = observed(node('root/div-shape-default-b:0'), 100);
        first.layout = { paddingLeft: 0 }; second.layout = { paddingLeft: 0 };
        const base = node('root', [node('parent', [first, second])]);
        const closed = observed(variant('root/div-shape-captured:0', 'item.mode', 'closed', [], 2), 100, 'closed');
        const open = observed(variant('root/div-shape-captured:0', 'item.mode', 'open', [], 4), 100, 'open');
        const captured = node('root', [node('parent', [closed, open])]);
        const result = composeApplicationStateDimensions(base, [{ key: 'item.mode', root: captured }]);
        expect(result.root.children[0]!.children[0]!.responsive?.applicationStateVariants).toBeUndefined();
        expect(result.root.children[0]!.children[1]!.responsive?.applicationStateVariants).toHaveLength(2);
    });

    test('does not promote visual capture drift without state-owned source evidence', () => {
        const observed = (color: string) => {
            const item = node('item');
            item.paint = { backgroundColor: color };
            (item as any).raw_source = { node: { attributes: { class: 'same' },
                styleProvenanceWinners: { 'background-color': '#same-rule' } } };
            return item;
        };
        const base = node('root', [observed('#181818')]);
        const captured = node('root', [
            { ...observed('#001a2b'), stable_anchor_id: 'application-state:closed::item',
                responsive: { visibility: [{ visible: true, structural: true }], layoutVariants: [],
                    sampledViewports: [], applicationStateKey: 'menu.open',
                    visibilityByApplicationState: { closed: true } } },
            { ...observed('#001833'), stable_anchor_id: 'application-state:open::item',
                responsive: { visibility: [{ visible: true, structural: true }], layoutVariants: [],
                    sampledViewports: [], applicationStateKey: 'menu.open',
                    visibilityByApplicationState: { open: true } } },
        ]);

        const result = composeApplicationStateDimensions(base, [{ key: 'menu.open', root: captured }]);
        expect(result.root.children[0]!.responsive?.applicationStateVariants).toBeUndefined();
        expect(result.root.children[0]!.paint?.backgroundColor).toBe('#181818');
    });

    test('promotes descendant layout controlled by an authored ancestor-state selector', () => {
        const appBar = (paddingLeft: number) => {
            const item = node('app-bar');
            item.layout = { paddingLeft };
            (item as any).raw_source = { node: { attributes: {
                class: 'pl-4 group-data-[state=collapsed]/sidebar-wrapper:pl-[var(--window-controls-inset)]',
                'data-slot': 'app-bar',
            } } };
            return item;
        };
        const baseBar = appBar(16);
        const base = node('root', [node('shell', [baseBar])]);
        const captured = node('root', [
            variant('shell', 'sidebar.open', 'open', [appBar(16)]),
            variant('shell', 'sidebar.open', 'closed', [appBar(160)]),
        ]);

        const result = composeApplicationStateDimensions(base, [{ key: 'sidebar.open', root: captured }]);
        expect(result.root.children[0]!.children[0]!.responsive?.applicationStateBase?.layout?.paddingLeft)
            .toBe('16');
        expect(result.root.children[0]!.children[0]!.responsive?.applicationStateVariants)
            .toEqual([
                { key: 'sidebar.open', value: 'open' },
                { key: 'sidebar.open', value: 'closed', layout: { paddingLeft: '160' } },
            ]);
    });

    test('applies a nested theme only inside its declared route context', () => {
        const base = node('root', [node('content', [node('chat')])]);
        const route = node('root', [
            variant('content', 'navigation.route', 'chat', [node('chat')]),
            variant('content', 'navigation.route', 'settings', [node('settings')]),
        ]);
        const light = node('settings'); light.paint = { backgroundColor: '#ffffff' };
        const dark = node('settings'); dark.paint = { backgroundColor: '#111111' };
        const theme = node('root', [
            variant('content', 'settings.theme', 'light', [light]),
            variant('content', 'settings.theme', 'dark', [dark]),
        ]);
        const result = composeApplicationStateDimensions(base, [
            { key: 'settings.theme', root: theme, when: [{ key: 'navigation.route', value: 'settings' }] },
            { key: 'navigation.route', root: route },
        ]);
        const [chat, settings] = result.root.children[0]!.children;
        expect(chat!.responsive?.applicationStateVariants).toBeUndefined();
        expect(settings!.responsive?.applicationStateVariants).toHaveLength(2);
        expect(settings!.responsive?.applicationStateVariants?.[0]?.when)
            .toEqual([{ key: 'navigation.route', value: 'settings' }]);
    });

    test('keeps scoped property changes on a shared ancestor guarded by their applicability predicate', () => {
        const base = node('root', [node('shell')]);
        base.children[0]!.layout = { paddingLeft: 4 };
        const captured = node('root', [
            variant('shell', 'sidebar.open', 'open', [], 4),
            variant('shell', 'sidebar.open', 'closed', [], 20),
        ]);
        const result = composeApplicationStateDimensions(base, [{
            key: 'sidebar.open', root: captured,
            when: [{ key: 'navigation.route', value: 'chat' }],
        }]);
        expect(result.root.children[0]!.responsive?.applicationStateVariants).toEqual([
            { key: 'sidebar.open', value: 'open', when: [{ key: 'navigation.route', value: 'chat' }] },
            { key: 'sidebar.open', value: 'closed', when: [{ key: 'navigation.route', value: 'chat' }],
                layout: { paddingLeft: '20' } },
        ]);
    });

    test('assigns repeated invariant descendants only to the dimension that changes them', () => {
        const item = (label: string, paddingLeft = 0) => {
            const result = node('shared-frontier');
            (result as any).text = { text: label };
            result.layout = { paddingLeft };
            return result;
        };
        const base = node('root', [node('panel', ['A', 'B', 'C', 'D'].map((label) => item(label)))]);
        const review = node('root', [
            variant('panel', 'review.panel', 'closed', ['A', 'B', 'C', 'D'].map((label) => item(label))),
            variant('panel', 'review.panel', 'open', ['A', 'B', 'C', 'D'].map((label) => item(label))),
        ]);
        const displayChildren = ['A', 'B', 'C', 'D'].flatMap((label, index) => {
            const defaultItem = variant('shared-frontier', 'display.mode', 'default', [], index);
            const verboseItem = variant('shared-frontier', 'display.mode', 'verbose', [], index + 10);
            (defaultItem as any).text = { text: label };
            (verboseItem as any).text = { text: label };
            return [defaultItem, verboseItem];
        });
        const display = node('root', [node('panel', displayChildren)]);

        const composed = composeApplicationStateDimensions(base, [
            { key: 'review.panel', root: review },
            { key: 'display.mode', root: display },
        ]);

        const children = composed.root.children[0]!.children;
        expect(children).toHaveLength(4);
        for (const child of children) {
            expect(child.responsive?.applicationStateVariants?.map(({ key }) => key))
                .toEqual(['display.mode', 'display.mode']);
            expect(child.responsive?.applicationStateKey).toBeUndefined();
        }
    });

    test('recomposes identical property variants idempotently and rejects stale conflicts', () => {
        const base = node('root', [node('panel')]);
        base.children[0]!.layout = { paddingLeft: 0 };
        base.children[0]!.responsive = {
            visibility: [], layoutVariants: [], sampledViewports: [],
            applicationStateBase: { layout: { paddingLeft: '0' } },
            applicationStateVariants: [
                { key: 'display.mode', value: 'default' },
                { key: 'display.mode', value: 'verbose', layout: { paddingLeft: '8' } },
            ],
        };
        const captured = node('root', [
            variant('panel', 'display.mode', 'default', [], 0),
            variant('panel', 'display.mode', 'verbose', [], 8),
        ]);
        const composed = composeApplicationStateDimensions(base, [{ key: 'display.mode', root: captured }]);
        expect(composed.root.children[0]!.responsive?.applicationStateVariants).toHaveLength(2);

        const stale = structuredClone(base);
        stale.children[0]!.responsive!.applicationStateVariants![1]!.layout!.paddingLeft = '9';
        expect(() => composeApplicationStateDimensions(stale, [{ key: 'display.mode', root: captured }]))
            .toThrow('conflicts with an existing variant');
    });

    test('is invariant to independent dimension input order', () => {
        const base = node('root', [node('left', [node('menu')]), node('right', [node('panel')])]);
        base.children[0]!.children[0]!.layout = { paddingLeft: 0 };
        base.children[1]!.children[0]!.layout = { paddingLeft: 0 };
        const menu = node('root', [node('left', [
            variant('menu', 'menu.open', 'closed', [], 0),
            variant('menu', 'menu.open', 'open', [], 4),
        ]), node('right', [node('panel')])]);
        const panel = node('root', [node('left', [node('menu')]), node('right', [
            variant('panel', 'panel.open', 'closed', [], 0),
            variant('panel', 'panel.open', 'open', [], 8),
        ])]);
        const forward = composeApplicationStateDimensions(base, [
            { key: 'menu.open', root: menu }, { key: 'panel.open', root: panel },
        ]);
        const reverse = composeApplicationStateDimensions(base, [
            { key: 'panel.open', root: panel }, { key: 'menu.open', root: menu },
        ]);
        expect(reverse).toEqual(forward);
    });

    test('assigns shared structural capture drift to the presence dimension', () => {
        const base = node('root', [node('panel', [node('card')])]);
        const panel = node('root', [
            variant('panel', 'review.panel.open', 'closed', [node('card')]),
            variant('panel', 'review.panel.open', 'open'),
        ]);
        const display = node('root', [
            variant('panel', 'display.mode', 'default', [node('card')]),
            variant('panel', 'display.mode', 'verbose'),
        ]);
        const forward = composeApplicationStateDimensions(base, [
            { key: 'display.mode', root: display }, { key: 'review.panel.open', root: panel },
        ]);
        const reverse = composeApplicationStateDimensions(base, [
            { key: 'review.panel.open', root: panel }, { key: 'display.mode', root: display },
        ]);
        expect(reverse).toEqual(forward);
        expect(forward.root.children[0]!.children[0]!.responsive?.applicationStateKey)
            .toBe('review.panel.open');
    });

    test('fails closed when a repeated state instance moves between parents', () => {
        const captured = node('root', [
            node('first-parent', [variant('shared-frontier', 'panel.open', 'closed')]),
            node('second-parent', [variant('shared-frontier', 'panel.open', 'open')]),
        ]);
        expect(() => composeApplicationStateDimensions(node('root', [
            node('first-parent', [node('shared-frontier')]), node('second-parent'),
        ]), [{ key: 'panel.open', root: captured }])).toThrow('ambiguously reparented');
    });

    test('rejects overlapping ownership and growth beyond the explicit budget', () => {
        const base = node('root', [node('panel', [node('menu')])]);
        base.children[0].layout = { paddingLeft: 0 };
        const first = node('root', [variant('panel', 'first', 'a', [node('menu')], 4), variant('panel', 'first', 'b', [node('menu')], 8)]);
        const conflict = node('root', [variant('panel', 'second', 'a', [node('menu')], 12), variant('panel', 'second', 'b', [node('menu')], 16)]);
        expect(() => composeApplicationStateDimensions(base, [{ key: 'first', root: first }, { key: 'second', root: conflict }]))
            .toThrow('conflicts between');
        const inner = node('root', [node('panel', [variant('menu', 'inner', 'a'), variant('menu', 'inner', 'b')])]);
        expect(() => composeApplicationStateDimensions(base, [{ key: 'first', root: first }, { key: 'inner', root: inner }],
            { maxNodeGrowthRatio: .9 })).toThrow('exceeds budget');

        const firstStructure = node('root', [
            variant('panel', 'first-structure', 'a', [node('one')]),
            variant('panel', 'first-structure', 'b', [node('two', [node('child')])]),
        ]);
        const secondStructure = node('root', [
            variant('panel', 'second-structure', 'a', [node('three')]),
            variant('panel', 'second-structure', 'b', [node('four', [node('child')])]),
        ]);
        const independent = composeApplicationStateDimensions(base, [
            { key: 'first-structure', root: firstStructure },
            { key: 'second-structure', root: secondStructure },
        ]);
        expect(independent.root.children[0]!.children.map(({ source_node_id }) => source_node_id))
            .toEqual(['three', 'four', 'one', 'two', 'menu']);

        const firstShared = node('root', [
            variant('panel', 'first-shared', 'a', [node('shared')]),
            variant('panel', 'first-shared', 'b', []),
        ]);
        const secondShared = node('root', [
            variant('panel', 'second-shared', 'a', [node('shared')]),
            variant('panel', 'second-shared', 'b', []),
        ]);
        expect(() => composeApplicationStateDimensions(base, [
            { key: 'first-shared', root: firstShared },
            { key: 'second-shared', root: secondShared },
        ])).toThrow('missing applicability context for structural overlap');
        const scopedBase = structuredClone(base);
        scopedBase.responsive = { visibility: [], layoutVariants: [], sampledViewports: [],
            applicationStateKey: 'route', visibilityByApplicationState: { chat: true, settings: false } };
        expect(() => composeApplicationStateDimensions(scopedBase, [
            { key: 'first-shared', root: firstShared, when: [{ key: 'route', value: 'chat' }] },
            { key: 'second-shared', root: secondShared, when: [{ key: 'route', value: 'chat' }] },
        ])).toThrow('structural frontier');
    });
});
