import { describe, expect, test } from 'vitest';
import { mergeNativeAssetManifests } from '../src/native-asset-manifest.js';

describe('native asset manifest composition', () => {
    test('merges state-owned assets deterministically and deduplicates identical entries', () => {
        const shared = { asset_id: 'asset-b', content_hash: 'hash-b', mime: 'image/svg+xml' };
        expect(mergeNativeAssetManifests(
            { version: 1, assets: [shared] },
            { version: 1, assets: [
                { asset_id: 'asset-a', content_hash: 'hash-a', mime: 'image/png' },
                { mime: 'image/svg+xml', content_hash: 'hash-b', asset_id: 'asset-b' },
            ] },
        ).assets).toEqual([
            { asset_id: 'asset-a', content_hash: 'hash-a', mime: 'image/png' },
            shared,
        ]);
    });

    test('refuses conflicting payloads for one asset identity', () => {
        expect(() => mergeNativeAssetManifests(
            { version: 1, assets: [{ asset_id: 'asset-a', content_hash: 'hash-a' }] },
            { version: 1, assets: [{ asset_id: 'asset-a', content_hash: 'hash-b' }] },
        )).toThrow('native asset manifest collision for asset-a');
    });

    test('refuses malformed manifests and asset identities', () => {
        expect(() => mergeNativeAssetManifests(
            { version: 2, assets: [] } as never,
        )).toThrow('invalid native asset manifest');
        expect(() => mergeNativeAssetManifests(
            { version: 1, assets: [{ asset_id: '' }] },
        )).toThrow('native asset manifest entry has no asset_id');
    });
});
