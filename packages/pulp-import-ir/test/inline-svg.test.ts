import { describe, expect, it } from 'vitest';
import { canonicalizeInlineSvg } from '../src/inline-svg.js';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const svgSource = '<svg viewBox="0 0 24 24"><path d="M2 12h20" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

describe('inline SVG faithful projection', () => {
    it('preserves path/viewBox/fill/stroke and resolves currentColor', () => {
        const result = canonicalizeInlineSvg({ sourceId: 'icon', outerHTML: svgSource, computedColor: 'rgb(12, 34, 56)' });
        expect('diagnostic' in result).toBe(false);
        if ('diagnostic' in result) return;
        expect(result.viewBox).toBe('0 0 24 24');
        expect(result.document).toContain('d="M2 12h20"');
        expect(result.document).toContain('fill="none"');
        expect(result.document).toContain('stroke="rgb(12, 34, 56)"');
        expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('emits a faithful_svg asset consumed by native materialization', () => {
        const source: ObservedDomNode = {
            sourceId: 'root', tagName: 'main', computedStyle: { display: 'flex' },
            rect: { x: 0, y: 0, width: 100, height: 100 },
            children: [{
                sourceId: 'icon', tagName: 'svg', computedStyle: { display: 'block' },
                attributes: { 'data-pulp-semantic-id': 'fixture.icon', 'data-pulp-action': 'fixture.vector' },
                rect: { x: 0, y: 0, width: 24, height: 24 }, children: [],
            }],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(source, '2026-07-11T00:00:00Z'), {
            sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z',
            inlineSvgCaptures: [{ sourceId: 'icon', outerHTML: svgSource, computedColor: '#123456' }],
        });
        const icon = (native.root.children as Record<string, unknown>[])[0];
        expect(icon).toMatchObject({ render_mode: 'faithful_svg' });
        expect(icon.svg_asset_id).toBe((native.assetManifest.assets[0] as Record<string, unknown>).asset_id);
        expect(icon.interactiveElements).toEqual([expect.objectContaining({
            kind: 'action', action: 'fixture.vector', source_node_id: 'icon', w: 24, h: 24,
        })]);
        expect((native.assetManifest.assets[0] as Record<string, unknown>).original_uri).toMatch(/^data:image\/svg\+xml,/);
        expect(native.diagnostics).toEqual([]);
    });

    it.each([
        ['missing viewBox', '<svg><path d="M0 0"/></svg>', 'inline-svg-viewbox-missing'],
        ['unresolved currentColor', svgSource, 'inline-svg-current-color-unresolved'],
        ['external reference', '<svg viewBox="0 0 1 1"><use href="https://example.test/a.svg#x"/></svg>', 'inline-svg-external-reference'],
        ['unsafe content', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>', 'inline-svg-unsafe-content'],
        ['event handler', '<svg viewBox="0 0 1 1" onload="alert(1)"><path d="M0 0"/></svg>', 'inline-svg-unsafe-attribute'],
        ['CSS external URL', '<svg viewBox="0 0 1 1"><path style="fill:url(https://example.test/a.svg)" d="M0 0"/></svg>', 'inline-svg-external-reference'],
        ['data URL', '<svg viewBox="0 0 1 1"><use href="data:image/svg+xml,%3Csvg/%3E"/></svg>', 'inline-svg-external-reference'],
        ['DTD', '<!DOCTYPE svg [<!ENTITY x "boom">]><svg viewBox="0 0 1 1"><title>&x;</title></svg>', 'inline-svg-unsafe-content'],
        ['unallowlisted element', '<svg viewBox="0 0 1 1"><image href="#x"/></svg>', 'inline-svg-unsafe-content'],
    ])('names %s instead of partially rewriting', (_name, outerHTML, code) => {
        const result = canonicalizeInlineSvg({ sourceId: 'fixture-icon', outerHTML });
        expect(result).toMatchObject({ diagnostic: { code, path: 'fixture-icon' } });
    });

    it('projects captures by source provenance even when semantic promotion changes the tag', () => {
        const source: ObservedDomNode = {
            sourceId: 'promoted', tagName: 'button', computedStyle: { display: 'flex' },
            rect: { x: 0, y: 0, width: 24, height: 24 }, children: [],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(source, '2026-07-11T00:00:00Z'), {
            sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z',
            inlineSvgCaptures: [{ sourceId: 'promoted', outerHTML: svgSource, computedColor: '#123456' }],
        });
        expect(native.root).toMatchObject({ render_mode: 'faithful_svg' });
        expect(native.diagnostics).toEqual([]);
    });
});
