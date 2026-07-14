import { describe, expect, it } from 'vitest';
import { buildImportedFontInventory, macosSkiaPlatformFontContract, parseCssFontFamilies, projectAggregateRuntimeFontFaces } from '../src/imported-fonts.js';
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

    it.each([
        ['-apple-system, system-ui, "Segoe UI", sans-serif', 600, 'normal', '.AppleSystemUIFont'],
        ['ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', 400, 'normal', '.AppleSystemUIFontMonospaced'],
    ])('records explicit macOS CoreText platform provenance for %s', (fontFamily, fontWeight, fontStyle, platformFace) => {
        const result = buildImportedFontInventory(
            [{ sourceId: 'system-face', fontFamily, fontWeight, fontStyle }],
            [],
            macosSkiaPlatformFontContract,
        );
        expect(result.diagnostics).toEqual([]);
        expect(result.assets).toEqual([]);
        expect(result.fontFamilyAssets[0]).toMatchObject({
            family: result.resolutions[0].provenance?.cssAlias,
            weight: fontWeight,
            style: fontStyle,
            platform_face: platformFace,
            provenance: { platform: 'macos', os: 'macos', runtime: 'coretext-skia' },
        });
        expect(result.resolutions[0]).toMatchObject({
            exact: true,
            requestedWeight: fontWeight,
            requestedStyle: fontStyle,
            platformFace,
            provenance: { platform: 'macos', os: 'macos', runtime: 'coretext-skia' },
        });
    });

    it('fails closed for platform aliases without an explicit platform contract', () => {
        const result = buildImportedFontInventory(
            [{ sourceId: 'system-face', fontFamily: 'system-ui, sans-serif', fontWeight: 400 }],
            [],
        );
        expect(result.resolutions[0]).toMatchObject({ exact: false });
        expect(result.diagnostics[0]).toMatchObject({ code: 'font-face-unresolved' });
    });

    it('uses source runtime font receipts to preserve the face actually selected by CSS', () => {
        const runtimeUsedFonts = [{ family: 'Menlo', postScriptName: 'Menlo-Bold', custom: false, glyphCount: 16 }];
        const result = buildImportedFontInventory([{
            sourceId: 'code',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
            fontWeight: 700,
            runtimeUsedFonts,
        }], [], macosSkiaPlatformFontContract);
        expect(result.diagnostics).toEqual([]);
        expect(result.resolutions[0]).toMatchObject({
            exact: true, requestedWeight: 700, requestedStyle: 'normal',
            resolvedFamilies: ['Menlo'], runtimeUsedFonts,
        });
        expect(result.fontFamilyAssets[0]).toMatchObject({
            family: 'Menlo', weight: 700, platform_face: 'Menlo-Bold',
            provenance: { runtime: 'cdp-platform-fonts' },
        });
    });

    it('does not register descendant bold and monospace faces as the paragraph body face', () => {
        const result = buildImportedFontInventory([{
            sourceId: 'mixed-paragraph', fontFamily: '-apple-system, system-ui, sans-serif', fontWeight: 400,
            runtimeUsedFonts: [
                { family: '.SF NS', postScriptName: '.SFNS-Bold', custom: false, glyphCount: 8 },
                { family: '.SF NS', postScriptName: '.SFNS-Regular', custom: false, glyphCount: 92 },
                { family: 'Menlo', postScriptName: 'Menlo-Regular', custom: false, glyphCount: 35 },
            ],
        }], [], macosSkiaPlatformFontContract);
        expect(result.fontFamilyAssets).toEqual([expect.objectContaining({
            family: '.SF NS', weight: 400, platform_face: '.SFNS-Regular',
        })]);
    });

    it('projects aggregate CDP runtime faces onto compatible observed font stacks', () => {
        const projected = projectAggregateRuntimeFontFaces([
            { sourceId: 'body', fontFamily: '-apple-system, system-ui, sans-serif' },
            { sourceId: 'code', fontFamily: 'ui-monospace, Menlo, monospace' },
        ], [
            { family: '.SF NS', postScriptName: '.SFNS-Regular', custom: false, glyphCount: 40 },
            { family: 'Menlo', postScriptName: 'Menlo-Regular', custom: false, glyphCount: 8 },
        ]);
        expect(projected[0].runtimeUsedFonts?.map((face) => face.family)).toEqual(['.SF NS']);
        expect(projected[1].runtimeUsedFonts?.map((face) => face.family)).toEqual(['Menlo']);
    });

    it('does not treat a source-runtime custom font name as native availability proof', () => {
        const result = buildImportedFontInventory([{
            sourceId: 'custom', fontFamily: 'Unbundled Custom', fontWeight: 400,
            runtimeUsedFonts: [{ family: 'Unbundled Custom', postScriptName: 'Custom-Regular', custom: true, glyphCount: 8 }],
        }], [], macosSkiaPlatformFontContract);
        expect(result.resolutions[0]).toMatchObject({ exact: false });
        expect(result.diagnostics[0]).toMatchObject({ code: 'font-face-unresolved' });
    });

    it('rewrites native style to the captured runtime family while retaining the receipt', () => {
        const observed: ObservedDomNode = {
            sourceId: 'code', tagName: 'code', text: 'let value = 1',
            computedStyle: {
                display: 'inline', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                fontWeight: '700', fontStyle: 'normal', fontSize: '13px',
            },
            usedFonts: [{ family: 'Menlo', postScriptName: 'Menlo-Bold', custom: false, glyphCount: 13 }],
            rect: { x: 0, y: 0, width: 100, height: 18 }, children: [],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(observed, 'now'), {
            sourceFile: '/runtime-font', importedAt: 'now', platformFonts: macosSkiaPlatformFontContract,
        });
        expect(native.root.style).toEqual(expect.objectContaining({ fontFamily: 'Menlo', fontWeight: 700 }));
        expect(native.fontFamilyAssets[0]).toMatchObject({ family: 'Menlo', platform_face: 'Menlo-Bold' });
        expect(native.diagnostics).toEqual([]);
    });

    it('projects the captured runtime system family while recording the exact macOS face', () => {
        const observed: ObservedDomNode = {
            sourceId: 'body', tagName: 'p', text: 'System text',
            computedStyle: { display: 'block', fontFamily: '-apple-system, system-ui, sans-serif',
                fontWeight: '400', fontSize: '15px' },
            usedFonts: [{ family: '.SF NS', postScriptName: '.SFNS-Regular', custom: false, glyphCount: 11 }],
            rect: { x: 0, y: 0, width: 100, height: 22 }, children: [],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(observed, 'now'), {
            sourceFile: '/system-font', importedAt: 'now', platformFonts: macosSkiaPlatformFontContract,
        });
        expect(native.root.style).toEqual(expect.objectContaining({
            fontFamily: '.SF NS',
        }));
        expect(native.fontFamilyAssets[0]).toMatchObject({
            family: '.SF NS', platform_face: '.SFNS-Regular',
            css_alias: '-apple-system, system-ui, sans-serif',
            provenance: { runtime: 'cdp-platform-fonts' },
        });
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
