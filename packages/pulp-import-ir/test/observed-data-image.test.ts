import { describe, expect, test } from 'bun:test';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==';
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
        for (const src of ['https://example.test/icon.png', 'data:image/png,raw', 'data:image/svg+xml;base64,PHN2Zy8+'])
            expect(() => toNativeDesignIrV1(lowerObservedDom(source(src), 'now'), { sourceFile: '/fixture', importedAt: 'now' }))
                .toThrow('supported base64 PNG, JPEG, or WebP');
    });
});
