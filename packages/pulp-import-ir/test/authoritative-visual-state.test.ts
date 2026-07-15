import { describe, expect, test } from 'vitest';
import { rebaseAuthoritativeVisualState } from '../src/authoritative-visual-state.js';

const node = (source_node_id: string, style: Record<string, unknown>, children: any[] = [], extra = {}) =>
    ({ source_node_id, style, children, ...extra });

describe('authoritative visual-state rebase', () => {
    test('updates source-observed visuals while preserving composed layout and contracts', () => {
        const target = node(
            'dom/html-shape-opaque:0/body-shape-body:0',
            { backgroundColor: '#181818ff', width: 1200, position: 'static' },
            [node('dom/html-shape-opaque:0/body-shape-body:0/div-id-root:0',
                { backgroundColor: '#0d0d0dff', minWidth: 800 }, [], {
                    responsive: { horizontal: { min: 800 } },
                    interaction: { actionBindingId: 'navigation.back' },
                    visualSkin: { hovered: { backgroundColor: '#222222ff' } },
                })],
        );
        const authority = node(
            'dom/html-shape-transparent:0/body-shape-body:0',
            { backgroundColor: '#00000000', width: 1200 },
            [node('dom/html-shape-transparent:0/body-shape-body:0/div-id-root:0',
                { backgroundColor: '#0d0d0d2e', minWidth: 1200 }, [], {
                    visualSkin: { hovered: { backgroundColor: '#ffffff1a' } },
                })],
        );
        const result = rebaseAuthoritativeVisualState(target, authority);
        expect(result.root.style).toEqual({ width: 1200, position: 'static', backgroundColor: '#00000000' });
        expect(result.root.children![0].style).toEqual({ minWidth: 800, backgroundColor: '#0d0d0d2e' });
        expect(result.root.children![0].responsive).toEqual({ horizontal: { min: 800 } });
        expect(result.root.children![0].interaction).toEqual({ actionBindingId: 'navigation.back' });
        expect(result.root.children![0].visualSkin).toEqual({ hovered: { backgroundColor: '#ffffff1a' } });
        expect(result.report).toMatchObject({
            authoritativeNodeCount: 2,
            targetNodeCount: 2,
            matchedAuthoritativeNodeCount: 2,
            rebasedTargetNodeCount: 2,
            unmatchedAuthoritativeSourceIds: [],
        });
    });

    test('updates every composed target copy from one authoritative identity', () => {
        const id = 'dom/html-shape-a:0/body-shape-b:0/div-id-root:0/button-data-slot-trigger:0';
        const target = node('dom/html-shape-a:0/body-shape-b:0', {}, [
            node(id, { color: '#ffffffff' }),
            node(id, { color: '#eeeeeeff' }, [], { responsive: { applicationStateKey: 'menu' } }),
        ]);
        const authority = node('dom/html-shape-c:0/body-shape-b:0', {}, [
            node(id.replace('html-shape-a', 'html-shape-c'), { color: '#ffffffb3' }),
        ]);
        const result = rebaseAuthoritativeVisualState(target, authority);
        expect(result.root.children!.map((child) => child.style?.color)).toEqual(['#ffffffb3', '#ffffffb3']);
        expect(result.report.rebasedTargetNodeCount).toBe(3);
    });

    test('fails closed when authoritative stable identity is ambiguous', () => {
        const target = node('dom/body-shape-b:0', {});
        const duplicate = 'dom/html-shape-a:0/div-id-root:0/button-data-slot-trigger:0';
        const authority = node('dom/body-shape-c:0', {}, [
            node(duplicate, {}),
            node(duplicate.replace('html-shape-a', 'html-shape-z'), {}),
        ]);
        expect(() => rebaseAuthoritativeVisualState(target, authority)).toThrow(/ambiguous stable identities/);
    });
});
