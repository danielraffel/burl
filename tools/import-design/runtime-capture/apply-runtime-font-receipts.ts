import { readFile, writeFile } from 'node:fs/promises';

type UsedFont = { family: string; postScriptName: string; custom: boolean; glyphCount: number };
type ObservedNode = { sourceId: string; usedFonts?: UsedFont[]; children?: ObservedNode[] };
type NativeNode = {
    source_node_id?: string;
    style?: Record<string, unknown>;
    visualSkin?: { states?: Record<string, Record<string, unknown>> };
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
const collect = (node: ObservedNode): void => {
    if (node.usedFonts?.some((font) => font.glyphCount > 0))
        receipts.set(node.sourceId, node.usedFonts.filter((font) => font.glyphCount > 0));
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
    const directReceipt = node.source_node_id ? receipts.get(node.source_node_id) : undefined;
    const receipt = directReceipt ?? (typeof node.style?.fontFamily === 'string'
        ? resolveAggregateFaces(node.style.fontFamily, aggregateFaces) : undefined);
    if (receipt?.length && node.style?.fontFamily) {
        const custom = receipt.filter((font) => font.custom);
        if (custom.length) {
            diagnostics.push({
                severity: 'error', kind: 'unresolved_asset', code: 'font-runtime-custom-unbundled',
                path: node.source_node_id, property: 'fontFamily',
                message: `source runtime used custom font ${custom.map((font) => font.postScriptName).join(', ')}; bundled bytes are required`,
            });
        } else {
            const families = [...new Set(receipt.map((font) => font.family))];
            node.style.fontFamily = families.map(cssFamily).join(', ');
            for (const state of Object.values(node.visualSkin?.states ?? {})) state.fontFamily = node.style.fontFamily;
            const weight = typeof node.style.fontWeight === 'number' ? node.style.fontWeight : 400;
            const style = typeof node.style.fontStyle === 'string' ? node.style.fontStyle : 'normal';
            for (const font of receipt) {
                const key = `${font.postScriptName}\0${weight}\0${style}`;
                faces.set(key, {
                    family: font.family, weight, style, platform_face: font.postScriptName,
                    provenance: { platform: 'source-runtime', os: 'captured', runtime: 'cdp-platform-fonts', cssAlias: node.style.fontFamily },
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

function cssFamily(family: string): string {
    return family;
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
