import { readFile, writeFile } from 'node:fs/promises';

type UsedFont = { family: string; postScriptName: string; custom: boolean; glyphCount: number };
type ObservedNode = { sourceId: string; usedFonts?: UsedFont[]; children?: ObservedNode[] };
type NativeNode = {
    source_node_id?: string;
    style?: Record<string, unknown>;
    visualSkin?: { states?: Record<string, Record<string, unknown>> };
    textRuns?: Array<Record<string, unknown>>;
    raw_source?: string;
    children?: NativeNode[];
};

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const capturePath = args.get('--capture');
const nativePath = args.get('--native');
const outputPath = args.get('--output');
if (!capturePath || !nativePath || !outputPath)
    throw new Error('usage: apply-runtime-font-receipts.ts --capture source-semantics.json --native design-ir.json --output design-ir.json');

const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
    observedDom?: ObservedNode;
    usedFaces?: Array<UsedFont & { nodeCount?: number; evidence?: { sourceId?: string } }>;
};
const native = JSON.parse(await readFile(nativePath, 'utf8')) as {
    root: NativeNode;
    fontFamilyAssets?: Record<string, unknown>[];
    diagnostics?: Record<string, unknown>[];
};
if (!capture.observedDom && !capture.usedFaces?.length)
    throw new Error('capture has neither an observedDom root nor aggregate usedFaces');

const receipts = new Map<string, UsedFont[]>();
const normalizedReceipts = new Map<string, UsedFont[] | null>();
const collect = (node: ObservedNode): void => {
    if (node.usedFonts?.some((font) => font.glyphCount > 0)) {
        const used = node.usedFonts.filter((font) => font.glyphCount > 0);
        receipts.set(node.sourceId, used);
        const normalized = stableSourceSuffix(node.sourceId);
        const previous = normalizedReceipts.get(normalized);
        normalizedReceipts.set(normalized, previous === undefined ? used : null);
    }
    node.children?.forEach(collect);
};
if (capture.observedDom) collect(capture.observedDom);
for (const face of capture.usedFaces ?? []) {
    const sourceId = face.evidence?.sourceId;
    if (sourceId) receipts.set(sourceId, [face]);
}
const aggregateFaces = (capture.usedFaces ?? []).filter((face) => face.glyphCount > 0);

const faces = new Map<string, Record<string, unknown>>();
const diagnostics = (native.diagnostics ?? []).filter((item) => item.code !== 'font-runtime-receipt-missing');
let applied = 0;
const apply = (node: NativeNode): void => {
    const directReceipt = node.source_node_id ? receiptForSourceId(node.source_node_id) : undefined;
    const sourceFamily = originalFontFamily(node) ?? node.style?.fontFamily;
    const receipt = directReceipt ?? (typeof sourceFamily === 'string'
        ? resolveAggregateFaces(sourceFamily, aggregateFaces) : undefined);
    if (receipt?.length && node.style?.fontFamily) {
        const custom = receipt.filter((font) => font.custom);
        if (custom.length) {
            diagnostics.push({
                severity: 'error', kind: 'unresolved_asset', code: 'font-runtime-custom-unbundled',
                path: node.source_node_id, property: 'fontFamily',
                message: `source runtime used custom font ${custom.map((font) => font.postScriptName).join(', ')}; bundled bytes are required`,
            });
        } else {
            const cssAlias = typeof sourceFamily === 'string'
                ? sourceFamily : String(node.style.fontFamily);
            // Older generated NativeIR replaced the CSS stack with Chromium's
            // private resolved family (for example `.SF NS`). Repair those
            // artifacts from the captured computed style; the receipt below
            // constrains resolution without erasing fallback semantics.
            node.style.fontFamily = cssAlias;
            for (const state of Object.values(node.visualSkin?.states ?? {}))
                state.fontFamily = cssAlias;
            const weight = typeof node.style.fontWeight === 'number' ? node.style.fontWeight : 400;
            const style = typeof node.style.fontStyle === 'string' ? node.style.fontStyle : 'normal';
            const fontSize = typeof node.style.fontSize === 'number' ? node.style.fontSize : 0;
            const primaryGlyphCount = Math.max(...receipt.map((font) => font.glyphCount));
            for (const font of receipt) {
                const key = `${font.postScriptName}\0${weight}\0${style}\0${fontSize}`;
                recordFace(faces, key, {
                    family: font.family, weight, style, font_size: fontSize,
                    platform_face: font.postScriptName,
                    css_alias: cssAlias, glyph_count: font.glyphCount,
                    primary_runtime_face: font.glyphCount === primaryGlyphCount,
                    provenance: { platform: 'source-runtime', os: 'captured', runtime: 'cdp-platform-fonts', cssAlias },
                });
            }
            ++applied;
        }
    }
    for (const run of node.textRuns ?? []) {
        if (typeof run.fontFamily !== 'string') continue;
        const runReceipt = resolveAggregateFaces(run.fontFamily, aggregateFaces);
        if (runReceipt?.length) {
            const cssAlias = run.fontFamily;
            const weight = typeof run.fontWeight === 'number' ? run.fontWeight : 400;
            const style = typeof run.fontStyle === 'string' ? run.fontStyle : 'normal';
            const fontSize = typeof run.fontSize === 'number' ? run.fontSize : 0;
            const primaryGlyphCount = Math.max(...runReceipt.map((font) => font.glyphCount));
            for (const font of runReceipt) {
                const key = `${font.postScriptName}\0${weight}\0${style}\0${fontSize}`;
                recordFace(faces, key, {
                    family: font.family, weight, style, font_size: fontSize,
                    platform_face: font.postScriptName,
                    css_alias: cssAlias, glyph_count: font.glyphCount,
                    primary_runtime_face: font.glyphCount === primaryGlyphCount,
                    provenance: { platform: 'source-runtime', os: 'captured', runtime: 'cdp-platform-fonts', cssAlias },
                });
            }
            ++applied;
        }
    }
    node.children?.forEach(apply);
};
apply(native.root);
if (applied === 0) throw new Error('no native text node matched a captured runtime font receipt');
native.fontFamilyAssets = [...faces.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, face]) => face);
native.diagnostics = diagnostics;
await writeFile(outputPath, `${JSON.stringify(native, null, 2)}\n`);

function receiptForSourceId(sourceId: string): UsedFont[] | undefined {
    // NativeIR represents ordered mixed content as generated `::text:N`
    // children. CDP records the used face on the containing DOM element, so a
    // generated text child inherits that exact receipt rather than falling
    // back to a generic family assumption.
    const containingSourceId = sourceId.replace(/::text:\d+$/, '');
    for (const candidate of [...new Set([sourceId, containingSourceId])]) {
        const direct = receipts.get(candidate);
        if (direct) return direct;
        const normalized = normalizedReceipts.get(stableSourceSuffix(candidate));
        if (normalized) return normalized;
    }
    return undefined;
}

function resolveAggregateFaces(css: string, faces: UsedFont[]): UsedFont[] | undefined {
    if (faces.length === 0) return undefined;
    const requested = css.split(',').map((value) => value.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase());
    const exact = faces.filter((face) => requested.includes(face.family.toLowerCase()));
    if (exact.length) return exact;
    const asksMono = requested.some((family) => family === 'monospace' || family === 'ui-monospace');
    const candidates = faces.filter((face) => /mono|menlo|consolas/i.test(`${face.family} ${face.postScriptName}`) === asksMono);
    return candidates.length ? candidates : undefined;
}

function recordFace(faces: Map<string, Record<string, unknown>>, key: string,
                    face: Record<string, unknown>): void {
    const previous = faces.get(key);
    if (!previous) {
        faces.set(key, face);
        return;
    }
    faces.set(key, {
        ...previous,
        glyph_count: Math.max(Number(previous.glyph_count ?? 0), Number(face.glyph_count ?? 0)),
        primary_runtime_face: previous.primary_runtime_face === true || face.primary_runtime_face === true,
    });
}

// The document and body shape hashes include root-level state such as theme
// classes. Descendants remain structurally identical when that state changes,
// so use the path below the first stable authored id as a unique fallback. An
// ambiguous suffix is deliberately rejected by normalizedReceipts above.
function stableSourceSuffix(sourceId: string): string {
    const segments = sourceId.split('/');
    const stableRoot = segments.findIndex((segment) => /-(?:id|data-slot)-/.test(segment));
    return stableRoot >= 0 ? segments.slice(stableRoot).join('/') : sourceId;
}

function originalFontFamily(node: NativeNode): string | undefined {
    if (!node.raw_source) return undefined;
    try {
        const raw = JSON.parse(node.raw_source);
        return typeof raw.computedStyle?.fontFamily === 'string' ? raw.computedStyle.fontFamily : undefined;
    } catch {
        return undefined;
    }
}
