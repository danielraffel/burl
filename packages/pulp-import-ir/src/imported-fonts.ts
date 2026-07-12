import type { IRNode } from './types.js';

export interface ObservedFontUse {
    sourceId: string;
    fontFamily: string;
    fontWeight?: number | string;
    fontStyle?: string;
    runtimeUsedFonts?: Array<{ family: string; postScriptName: string; custom: boolean; glyphCount: number }>;
}

export interface BundledFontSource {
    family: string;
    weight: number;
    style: 'normal' | 'italic' | 'oblique';
    bytes: Uint8Array;
    mime: 'font/ttf' | 'font/otf' | 'font/woff2';
    license: { spdx: string; redistributable: boolean };
    provenance: { sourceUri: string; sourceRevision?: string };
}

export interface ImportedFontDiagnostic {
    severity: 'error';
    kind: 'unresolved_asset';
    code: 'font-face-unresolved' | 'font-license-missing' | 'font-license-incompatible';
    path: string;
    property: 'fontFamily';
    message: string;
}

export interface ImportedFontInventory {
    version: 1;
    fontFamilyAssets: Record<string, unknown>[];
    assets: Record<string, unknown>[];
    resolutions: Array<{
        sourceId: string;
        requestedFamilies: string[];
        requestedWeight: number;
        requestedStyle: string;
        assetId?: string;
        platformFace?: string;
        provenance?: { platform: string; os: string; runtime: string; cssAlias: string };
        resolvedFamilies?: string[];
        runtimeUsedFonts?: Array<{ family: string; postScriptName: string; custom: boolean; glyphCount: number }>;
        exact: boolean;
    }>;
    diagnostics: ImportedFontDiagnostic[];
}

export interface PlatformFontContract {
    platform: string;
    os: string;
    runtime: string;
    aliases: Readonly<Record<string, string>>;
}

export const macosSkiaPlatformFontContract: PlatformFontContract = {
    platform: 'macos',
    os: 'macos',
    runtime: 'coretext-skia',
    aliases: {
        '-apple-system': '.AppleSystemUIFont',
        'blinkmacsystemfont': '.AppleSystemUIFont',
        'system-ui': '.AppleSystemUIFont',
        'sans-serif': '.AppleSystemUIFont',
        'ui-sans-serif': '.AppleSystemUIFont',
        'ui-monospace': '.AppleSystemUIFontMonospaced',
        'sfmono-regular': '.AppleSystemUIFontMonospaced',
        'sf mono': '.AppleSystemUIFontMonospaced',
        'monospace': '.AppleSystemUIFontMonospaced',
    },
};

export function buildImportedFontInventory(
    uses: readonly ObservedFontUse[],
    sources: readonly BundledFontSource[],
    platformFonts?: PlatformFontContract,
): ImportedFontInventory {
    const diagnostics: ImportedFontDiagnostic[] = [];
    const resolutions: ImportedFontInventory['resolutions'] = [];
    const assets = new Map<string, Record<string, unknown>>();
    const faces = new Map<string, Record<string, unknown>>();
    const orderedUses = [...uses].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    for (const use of orderedUses) {
        const families = parseCssFontFamilies(use.fontFamily);
        const weight = normalizeWeight(use.fontWeight);
        const style = normalizeStyle(use.fontStyle);
        if (use.runtimeUsedFonts?.length && use.runtimeUsedFonts.every((face) => !face.custom)) {
            const runtimeFaces = use.runtimeUsedFonts.filter((face) => face.glyphCount > 0);
            const resolvedFamilies = [...new Set(runtimeFaces.map((face) => face.family))];
            if (resolvedFamilies.length > 0) {
                for (const face of runtimeFaces) {
                    const faceKey = `runtime\0${face.postScriptName.toLocaleLowerCase('en-US')}\0${weight}\0${style}`;
                    faces.set(faceKey, {
                        family: face.family, weight, style, platform_face: face.postScriptName,
                        provenance: { platform: 'source-runtime', os: 'captured', runtime: 'cdp-platform-fonts', cssAlias: families.join(', ') },
                    });
                }
                resolutions.push({
                    sourceId: use.sourceId, requestedFamilies: families, requestedWeight: weight,
                    requestedStyle: style, resolvedFamilies, runtimeUsedFonts: runtimeFaces, exact: true,
                });
                continue;
            }
        }
        const match = sources.find((source) => families.some((family) => sameFamily(family, source.family))
            && source.weight === weight && source.style === style);
        if (!match) {
            const platformMatch = platformFonts ? families
                .map((family) => ({ alias: family, face: platformFonts.aliases[family.toLocaleLowerCase('en-US')] }))
                .find((candidate) => candidate.face) : undefined;
            if (platformMatch) {
                const provenance = {
                    platform: platformFonts!.platform,
                    os: platformFonts!.os,
                    runtime: platformFonts!.runtime,
                    cssAlias: platformMatch.alias,
                };
                const faceKey = `platform\0${platformMatch.face.toLocaleLowerCase('en-US')}\0${weight}\0${style}`;
                faces.set(faceKey, {
                    family: platformMatch.alias,
                    weight,
                    style,
                    platform_face: platformMatch.face,
                    provenance,
                });
                resolutions.push({
                    sourceId: use.sourceId,
                    requestedFamilies: families,
                    requestedWeight: weight,
                    requestedStyle: style,
                    platformFace: platformMatch.face,
                    provenance,
                    exact: true,
                });
                continue;
            }
            resolutions.push({ sourceId: use.sourceId, requestedFamilies: families, requestedWeight: weight, requestedStyle: style, exact: false });
            diagnostics.push(fontDiagnostic('font-face-unresolved', use.sourceId,
                `no bundled face exactly matches ${families.join(', ')} ${weight} ${style}; parity mode forbids substitution`));
            continue;
        }
        if (!match.license.spdx.trim()) {
            resolutions.push({ sourceId: use.sourceId, requestedFamilies: families, requestedWeight: weight, requestedStyle: style, exact: false });
            diagnostics.push(fontDiagnostic('font-license-missing', use.sourceId, `bundled face ${match.family} has no SPDX license`));
            continue;
        }
        if (!match.license.redistributable) {
            resolutions.push({ sourceId: use.sourceId, requestedFamilies: families, requestedWeight: weight, requestedStyle: style, exact: false });
            diagnostics.push(fontDiagnostic('font-license-incompatible', use.sourceId, `bundled face ${match.family} is not redistributable`));
            continue;
        }
        const hash = sha256Bytes(match.bytes);
        const assetId = `font-${hash.slice(0, 16)}`;
        assets.set(assetId, {
            asset_id: assetId,
            original_uri: `data:${match.mime};base64,${base64(match.bytes)}`,
            content_hash: hash,
            mime: match.mime,
            font_family: match.family,
            license: match.license.spdx,
            source_url: match.provenance.sourceUri,
            provenance: match.provenance,
            diagnostics: [],
        });
        const faceKey = `${match.family.toLocaleLowerCase('en-US')}\0${weight}\0${style}`;
        faces.set(faceKey, { family: match.family, weight, style, asset_id: assetId });
        resolutions.push({ sourceId: use.sourceId, requestedFamilies: families, requestedWeight: weight, requestedStyle: style, assetId, exact: true });
    }
    return {
        version: 1,
        fontFamilyAssets: [...faces.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
        assets: [...assets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
        resolutions,
        diagnostics,
    };
}

export function collectObservedFontUses(root: IRNode): ObservedFontUse[] {
    const uses: ObservedFontUse[] = [];
    const visit = (node: IRNode): void => {
        if (typeof node.text?.fontFamily === 'string' && !node.text.fontFamily.startsWith('{')) {
            uses.push({
                sourceId: node.source_node_id ?? node.stable_anchor_id,
                fontFamily: node.text.fontFamily,
                fontWeight: node.text.fontWeight,
                fontStyle: node.text.fontStyle,
                runtimeUsedFonts: node.meta?.runtime_used_fonts as ObservedFontUse['runtimeUsedFonts'],
            });
        }
        node.children.forEach(visit);
    };
    visit(root);
    return uses;
}

export function parseCssFontFamilies(value: string): string[] {
    return value.split(',').map((part) => part.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
}

function normalizeWeight(value: number | string | undefined): number {
    if (value === undefined || value === 'normal') return 400;
    if (value === 'bold') return 700;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(900, Math.max(100, Math.round(parsed / 100) * 100)) : 400;
}

function normalizeStyle(value: string | undefined): 'normal' | 'italic' | 'oblique' {
    const style = value?.trim().toLowerCase();
    return style === 'italic' || style === 'oblique' ? style : 'normal';
}

function sameFamily(a: string, b: string): boolean {
    return a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US');
}

function fontDiagnostic(code: ImportedFontDiagnostic['code'], path: string, message: string): ImportedFontDiagnostic {
    return { severity: 'error', kind: 'unresolved_asset', code, path, property: 'fontFamily', message };
}

function base64(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        result += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63]
            + (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=')
            + (i + 2 < bytes.length ? alphabet[value & 63] : '=');
    }
    return result;
}

function sha256Bytes(bytes: Uint8Array): string {
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const data = new Uint8Array(paddedLength); data.set(bytes); data[bytes.length] = 0x80;
    const view = new DataView(data.buffer);
    view.setUint32(paddedLength - 4, bitLength >>> 0); view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const w = new Uint32Array(64);
    const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
    for (let offset = 0; offset < data.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) { const x=w[i-15], y=w[i-2]; w[i]=(w[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0; }
        let [a,b,c,d,e,f,g,hh]=h;
        for (let i=0;i<64;i++) { const t1=(hh+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+w[i])>>>0; const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0; [hh,g,f,e,d,c,b,a]=[g,f,e,(d+t1)>>>0,c,b,a,(t1+t2)>>>0]; }
        [a,b,c,d,e,f,g,hh].forEach((value,i)=>{h[i]=(h[i]+value)>>>0;});
    }
    return [...h].map((value)=>value.toString(16).padStart(8,'0')).join('');
}
