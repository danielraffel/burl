export interface NativeAssetManifestAsset {
    asset_id: string;
    [key: string]: unknown;
}

export interface NativeAssetManifest {
    version: 1;
    assets: NativeAssetManifestAsset[];
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function mergeNativeAssetManifests(...manifests: readonly NativeAssetManifest[]): NativeAssetManifest {
    const assets = new Map<string, NativeAssetManifestAsset>();
    for (const manifest of manifests) {
        if (manifest.version !== 1 || !Array.isArray(manifest.assets))
            throw new Error('invalid native asset manifest');
        for (const asset of manifest.assets) {
            if (!asset || typeof asset.asset_id !== 'string' || !asset.asset_id.trim())
                throw new Error('native asset manifest entry has no asset_id');
            const prior = assets.get(asset.asset_id);
            if (prior && canonicalJson(prior) !== canonicalJson(asset))
                throw new Error(`native asset manifest collision for ${asset.asset_id}`);
            if (!prior) assets.set(asset.asset_id, structuredClone(asset));
        }
    }
    return {
        version: 1,
        assets: [...assets.values()].sort((left, right) => left.asset_id.localeCompare(right.asset_id)),
    };
}
