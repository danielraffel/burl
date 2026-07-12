import type { IRNode } from './types.js';

export interface InlineSvgCapture {
    sourceId: string;
    outerHTML: string;
    computedColor?: string;
}

export interface InlineSvgDiagnostic {
    severity: 'error';
    kind: 'unsupported_property' | 'capture_partial';
    code: string;
    path: string;
    property: string;
    message: string;
    anchor_id?: string;
}

export interface CanonicalInlineSvg {
    sourceId: string;
    document: string;
    assetId: string;
    contentHash: string;
    viewBox: string;
}

export interface InlineSvgProjection {
    documents: Map<string, CanonicalInlineSvg>;
    assets: Record<string, unknown>[];
    diagnostics: InlineSvgDiagnostic[];
}

export function projectInlineSvgCaptures(
    root: IRNode,
    captures: readonly InlineSvgCapture[],
): InlineSvgProjection {
    const nodes = new Map<string, IRNode>();
    visit(root, (node) => {
        if (node.source_node_id) nodes.set(node.source_node_id, node);
    });
    const documents = new Map<string, CanonicalInlineSvg>();
    const diagnostics: InlineSvgDiagnostic[] = [];
    const assets: Record<string, unknown>[] = [];
    const sorted = [...captures].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    for (const capture of sorted) {
        const node = nodes.get(capture.sourceId);
        if (!node || node.tag.toLowerCase() !== 'icon') continue;
        const result = canonicalizeInlineSvg(capture, node.stable_anchor_id);
        if ('diagnostic' in result) {
            diagnostics.push(result.diagnostic);
            continue;
        }
        documents.set(capture.sourceId, result);
        assets.push({
            asset_id: result.assetId,
            original_uri: `data:image/svg+xml,${encodeURIComponent(result.document)}`,
            content_hash: result.contentHash,
            mime: 'image/svg+xml',
            diagnostics: [],
        });
    }
    return { documents, assets, diagnostics };
}

export function canonicalizeInlineSvg(
    capture: InlineSvgCapture,
    anchorId?: string,
): CanonicalInlineSvg | { diagnostic: InlineSvgDiagnostic } {
    const source = capture.outerHTML.trim();
    const fail = (code: string, property: string, message: string): { diagnostic: InlineSvgDiagnostic } => ({
        diagnostic: {
            severity: 'error',
            kind: code === 'inline-svg-invalid' ? 'capture_partial' : 'unsupported_property',
            code,
            path: capture.sourceId,
            property,
            message,
            ...(anchorId ? { anchor_id: anchorId } : {}),
        },
    });
    if (!/^<svg(?:\s|>)/i.test(source) || !/<\/svg>$/i.test(source)) {
        return fail('inline-svg-invalid', 'outerHTML', 'captured inline SVG is not a complete SVG document');
    }
    if (/<(?:script|foreignObject)(?:\s|>)/i.test(source)) {
        return fail('inline-svg-unsafe-content', 'outerHTML', 'script and foreignObject content cannot enter the native SVG lane');
    }
    if (/\b(?:href|xlink:href)\s*=\s*["']\s*(?!#|data:)[^"']+/i.test(source)) {
        return fail('inline-svg-external-reference', 'href', 'external SVG references require a resolved, hashed asset');
    }
    const opening = source.match(/^<svg\b([^>]*)>/i);
    const viewBox = opening?.[1].match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!viewBox || !validViewBox(viewBox)) {
        return fail('inline-svg-viewbox-missing', 'viewBox', 'inline SVG requires a finite positive viewBox');
    }
    let document = source.replace(/>\s+</g, '><');
    if (/\bcurrentColor\b/i.test(document)) {
        if (!capture.computedColor || capture.computedColor.trim().length === 0) {
            return fail('inline-svg-current-color-unresolved', 'currentColor', 'currentColor requires the captured computed color');
        }
        document = document.replace(/\bcurrentColor\b/gi, capture.computedColor.trim());
    }
    const contentHash = sha256(document);
    return {
        sourceId: capture.sourceId,
        document,
        contentHash,
        assetId: `inline-svg-${contentHash.slice(0, 16)}`,
        viewBox: viewBox.trim().replace(/\s+/g, ' '),
    };
}

function validViewBox(value: string): boolean {
    const values = value.trim().split(/[\s,]+/).map(Number);
    return values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0;
}

function visit(node: IRNode, callback: (node: IRNode) => void): void {
    callback(node);
    node.children.forEach((child) => visit(child, callback));
}

function sha256(input: string): string {
    const bytes = new TextEncoder().encode(input);
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const data = new Uint8Array(paddedLength);
    data.set(bytes);
    data[bytes.length] = 0x80;
    const view = new DataView(data.buffer);
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const k = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
        const p = firstPrimes[i];
        k[i] = Math.floor((Math.cbrt(p) % 1) * 0x100000000) >>> 0;
    }
    const w = new Uint32Array(64);
    for (let offset = 0; offset < data.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15];
            const y = w[i - 2];
            const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
            const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
            const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (s0 + maj) >>> 0;
            [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
        }
        [a, b, c, d, e, f, g, hh].forEach((value, i) => { h[i] = (h[i] + value) >>> 0; });
    }
    return [...h].map((value) => value.toString(16).padStart(8, '0')).join('');
}

function rotate(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

const firstPrimes = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53,
    59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131,
    137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199,
    211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281,
    283, 293, 307, 311,
];
