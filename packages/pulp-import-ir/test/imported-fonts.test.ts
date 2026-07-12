import { describe, expect, it } from 'vitest';
import { buildImportedFontInventory, parseCssFontFamilies } from '../src/imported-fonts.js';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const face = {
    family: 'Fixture Sans', weight: 500, style: 'normal' as const,
    bytes: new TextEncoder().encode('deterministic fixture font bytes'), mime: 'font/ttf' as const,
    license: { spdx: 'OFL-1.1', redistributable: true },
    provenance: { sourceUri: 'fixture://fonts/medium.ttf', sourceRevision: 'abc123' },
};

describe('imported font inventory', () => {
    it('parses quoted CSS fallback families without changing order', () => {
        expect(parseCssFontFamilies('"Fixture Sans", system-ui, sans-serif')).toEqual(['Fixture Sans', 'system-ui', 'sans-serif']);
    });

    it('resolves an exact face into deterministic hashed manifests', () => {
        const first = buildImportedFontInventory([{ sourceId: 'title', fontFamily: '"Fixture Sans", sans-serif', fontWeight: '500' }], [face]);
        const second = buildImportedFontInventory([{ sourceId: 'title', fontFamily: '"Fixture Sans", sans-serif', fontWeight: '500' }], [face]);
        expect(first).toEqual(second);
        expect(first.diagnostics).toEqual([]);
        expect(first.resolutions[0]).toMatchObject({ exact: true, requestedWeight: 500, requestedStyle: 'normal' });
        expect(first.fontFamilyAssets[0]).toMatchObject({ family: 'Fixture Sans', weight: 500, asset_id: first.resolutions[0].assetId });
        expect(first.assets[0]).toMatchObject({ mime: 'font/ttf', license: 'OFL-1.1', source_url: 'fixture://fonts/medium.ttf' });
        expect(first.assets[0].content_hash).toBe('ea97f9b711ea6ba433baab0ef45225d4e55cce27a05db2769e12ce9504fd3dd5');
        expect(first.assets[0].provenance).toEqual(face.provenance);
    });

    it('fails closed rather than selecting a nearby weight or style', () => {
        const result = buildImportedFontInventory([{ sourceId: 'body', fontFamily: 'Fixture Sans', fontWeight: 700, fontStyle: 'italic' }], [face]);
        expect(result.resolutions[0]).toMatchObject({ exact: false, requestedWeight: 700, requestedStyle: 'italic' });
        expect(result.diagnostics[0]).toMatchObject({ code: 'font-face-unresolved', path: 'body', property: 'fontFamily' });
        expect(result.fontFamilyAssets).toEqual([]);
    });

    it('wires bundled faces and diagnostics into the native DesignIR envelope', () => {
        const observed: ObservedDomNode = {
            sourceId: 'root', tagName: 'main', computedStyle: { display: 'flex' }, rect: { x: 0, y: 0, width: 100, height: 40 },
            children: [{ sourceId: 'label', tagName: 'span', text: 'Text', computedStyle: { display: 'inline', fontFamily: 'Fixture Sans', fontWeight: '500' }, rect: { x: 0, y: 0, width: 40, height: 20 }, children: [] }],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(observed, '2026-07-11T00:00:00Z'), {
            sourceFile: '/fixture', importedAt: '2026-07-11T00:00:00Z', bundledFonts: [face],
        });
        expect(native.fontFamilyAssets[0]).toMatchObject({ family: 'Fixture Sans', weight: 500 });
        expect(native.assetManifest.assets[0]).toMatchObject({ font_family: 'Fixture Sans', license: 'OFL-1.1' });
        expect(native.diagnostics).toEqual([]);
    });

    it.each([
        [{ ...face, license: { spdx: '', redistributable: true } }, 'font-license-missing'],
        [{ ...face, license: { spdx: 'LicenseRef-Proprietary', redistributable: false } }, 'font-license-incompatible'],
    ])('rejects unusable license metadata', (source, code) => {
        const result = buildImportedFontInventory([{ sourceId: 'body', fontFamily: 'Fixture Sans', fontWeight: 500 }], [source]);
        expect(result.diagnostics[0]).toMatchObject({ code, path: 'body' });
        expect(result.assets).toEqual([]);
    });
});
