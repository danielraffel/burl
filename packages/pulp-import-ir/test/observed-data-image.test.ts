import { describe, expect, test } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==';
const svg = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#fff" d="M0 0h16v16H0z"/></svg>')}`;
const source = (src: string): ObservedDomNode => ({ sourceId: 'fixture-image', tagName: 'img', attributes: { src },
    computedStyle: { display: 'block', position: 'static' }, rect: { x: 0, y: 0, width: 16, height: 16 }, children: [] });

describe('observed data image projection', () => {
    test('projects a deterministic manifest asset and node reference', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source(png), 'now'), { sourceFile: '/fixture', importedAt: 'now' });
        const asset = native.assetManifest.assets[0] as Record<string, unknown>;
        expect(asset).toMatchObject({ original_uri: png, mime: 'image/png', diagnostics: [] });
        expect((native.root.attributes as Record<string, string>).srcAssetId).toBe(asset.asset_id);
        expect(asset.asset_id).toMatch(/^observed-image-[0-9a-f]{16}$/);
    });

    test('fails closed for remote, unencoded, and unsupported image sources', () => {
        for (const src of ['https://example.test/icon.png', 'data:image/png,raw'])
            expect(() => toNativeDesignIrV1(lowerObservedDom(source(src), 'now'), { sourceFile: '/fixture', importedAt: 'now' }))
                .toThrow('supported base64 PNG, JPEG, WebP, or SVG');
    });

    test('sanitizes and projects a captured SVG image', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source(svg), 'now'), { sourceFile: '/fixture', importedAt: 'now' });
        const asset = native.assetManifest.assets[0] as Record<string, unknown>;
        expect(asset).toMatchObject({ mime: 'image/svg+xml', diagnostics: [] });
        expect(asset.original_uri).toMatch(/^data:image\/svg\+xml;base64,/);
        expect((native.root.attributes as Record<string, string>).srcAssetId).toBe(asset.asset_id);
    });

    test('rejects unsafe captured SVG image content', () => {
        const unsafe = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script/></svg>')}`;
        expect(() => toNativeDesignIrV1(lowerObservedDom(source(unsafe), 'now'), { sourceFile: '/fixture', importedAt: 'now' }))
            .toThrow('unsafe or unsupported SVG');
    });

    test('can defer an unsupported candidate image for post-composition frontier validation', () => {
        const uri = 'https://example.test/icon.svg';
        const native = toNativeDesignIrV1(lowerObservedDom(source(uri), 'now'), {
            sourceFile: '/candidate', importedAt: 'now', sourceRevision: 'candidate-a',
            unsupportedObservedImagePolicy: 'defer',
        });
        expect(native.assetManifest.assets).toEqual([]);
        expect(native.diagnostics).toContainEqual(expect.objectContaining({
            kind: 'unsupported_observed_image_deferred',
            source_node_id: 'fixture-image',
            uri,
        }));
        expect((native.root.attributes as Record<string, string>).srcAssetId).toBeUndefined();
    });
});
