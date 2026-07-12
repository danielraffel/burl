import type { IRNode } from './types.js';
import { projectInlineSvgCaptures, type InlineSvgCapture, type InlineSvgProjection } from './inline-svg.js';
import { buildImportedFontInventory, collectObservedFontUses, type BundledFontSource, type ObservedFontUse, type PlatformFontContract } from './imported-fonts.js';

export interface NativeDesignIrMetadata {
    sourceFile: string;
    importedAt: string;
    sourceRevision?: string;
    inlineSvgCaptures?: readonly InlineSvgCapture[];
    observedFontUses?: readonly ObservedFontUse[];
    bundledFonts?: readonly BundledFontSource[];
    platformFonts?: PlatformFontContract;
}

export interface NativeDesignIrV1 {
    version: 1;
    source: 'jsx';
    sourceFile: string;
    capture_method: 'runtime_snapshot';
    settle_rounds: number;
    fallback_reason: string;
    source_adapter: 'observed-dom';
    source_version: '1.0.0';
    imported_at: string;
    root: Record<string, unknown>;
    tokens: { colors: Record<string, string>; dimensions: Record<string, number>; strings: Record<string, string> };
    assetManifest: { version: 1; assets: unknown[] };
    fontFamilyAssets: unknown[];
    diagnostics: unknown[];
}

export function toNativeDesignIrV1(root: IRNode, metadata: NativeDesignIrMetadata): NativeDesignIrV1 {
    const svg = projectInlineSvgCaptures(root, metadata.inlineSvgCaptures ?? []);
    const fonts = buildImportedFontInventory(metadata.observedFontUses ?? collectObservedFontUses(root), metadata.bundledFonts ?? [], metadata.platformFonts);
    return {
        version: 1,
        source: 'jsx',
        sourceFile: metadata.sourceFile,
        capture_method: 'runtime_snapshot',
        settle_rounds: 2,
        fallback_reason: '',
        source_adapter: 'observed-dom',
        source_version: '1.0.0',
        imported_at: metadata.importedAt,
        root: nodeToNative(root, metadata.sourceRevision, svg),
        tokens: { colors: {}, dimensions: {}, strings: {} },
        assetManifest: { version: 1, assets: [...svg.assets, ...fonts.assets] },
        fontFamilyAssets: fonts.fontFamilyAssets,
        diagnostics: [...svg.diagnostics, ...fonts.diagnostics],
    };
}

function nodeToNative(node: IRNode, sourceRevision: string | undefined, svg: InlineSvgProjection): Record<string, unknown> {
    const attributes: Record<string, string> = {};
    if (node.meta?.role) attributes.role = node.meta.role;
    if (node.meta?.semantic_id) attributes.semantic_id = node.meta.semantic_id;
    if (node.meta?.accessibility_name) attributes.accessibility_name = node.meta.accessibility_name;
    if (node.meta?.action_binding_id) attributes.action_binding_id = node.meta.action_binding_id;
    if (node.meta?.keyed_list_identity) attributes.keyed_list_identity = node.meta.keyed_list_identity;
    if (sourceRevision) attributes.source_revision = sourceRevision;
    const inlineSvg = node.source_node_id ? svg.documents.get(node.source_node_id) : undefined;
    return {
        type: nativeType(node.tag),
        name: node.meta?.semantic_id ?? node.source_node_id ?? node.tag,
        ...(node.text?.text ? { content: node.text.text } : {}),
        ...(node.textRuns && node.textRuns.length > 0 ? { textRuns: node.textRuns } : {}),
        layout: nativeLayout(node),
        style: nativeStyle(node),
        ...(node.token_refs ? { token_refs: node.token_refs } : {}),
        attributes,
        stable_anchor_id: node.stable_anchor_id,
        anchor_strategy: 'adapter',
        source_node_id: node.source_node_id ?? '',
        source_adapter: node.provenance.adapter,
        source_version: node.provenance.version,
        confidence: node.confidence.toLowerCase(),
        raw_source: JSON.stringify(node.raw_source),
        ...(inlineSvg ? { render_mode: 'faithful_svg', svg_asset_id: inlineSvg.assetId } : {}),
        children: node.children.map((child) => nodeToNative(child, sourceRevision, svg)),
    };
}

function nativeType(tag: string): string {
    const lower = tag.toLowerCase();
    if (lower === 'texteditor') return 'text_editor';
    if (lower === 'label') return 'text';
    if (lower === 'image') return 'image';
    if (lower === 'icon') return 'view';
    return lower;
}

function nativeLayout(node: IRNode): Record<string, unknown> {
    const value = node.layout ?? {};
    const out: Record<string, unknown> = {};
    if (value.display) out.display = value.display === 'inline-flex' ? 'flex' : value.display;
    if (value.flexDirection) out.direction = value.flexDirection.startsWith('row') ? 'row' : 'column';
    if (value.flexWrap) out.wrap = value.flexWrap !== 'nowrap';
    if (value.flexGrow !== undefined) out.flexGrow = value.flexGrow;
    if (value.flexShrink !== undefined) out.flexShrink = value.flexShrink;
    if (value.flexBasis !== undefined) out.flexBasis = String(value.flexBasis);
    if (value.order !== undefined) out.order = value.order;
    if (value.alignItems) out.align = normalizeAlign(value.alignItems);
    if (value.alignSelf) out.alignSelf = normalizeAlign(value.alignSelf);
    if (value.alignContent) out.alignContent = normalizeAlign(value.alignContent);
    if (value.justifyContent) out.justify = normalizeAlign(value.justifyContent);
    for (const [key, mapped] of [
        ['gap', 'gap'], ['rowGap', 'rowGap'], ['columnGap', 'columnGap'],
        ['paddingTop', 'paddingTop'], ['paddingRight', 'paddingRight'],
        ['paddingBottom', 'paddingBottom'], ['paddingLeft', 'paddingLeft'],
        ['marginTop', 'marginTop'], ['marginRight', 'marginRight'],
        ['marginBottom', 'marginBottom'], ['marginLeft', 'marginLeft'],
    ] as const) {
        const item = value[key];
        if (typeof item === 'number') out[mapped] = item;
    }
    if (value.overflowX) out.overflowX = value.overflowX;
    if (value.overflowY) out.overflowY = value.overflowY;
    if (typeof value.width === 'number') {
        out.widthMode = 'fixed';
        out.width = value.width;
    }
    if (typeof value.height === 'number') {
        out.heightMode = 'fixed';
        out.height = value.height;
    }
    return out;
}

function nativeStyle(node: IRNode): Record<string, unknown> {
    const paint = node.paint ?? {};
    const text = node.text ?? {};
    const layout = node.layout ?? {};
    const out: Record<string, unknown> = {};
    for (const key of [
        'backgroundColor', 'color', 'borderColor', 'borderWidth', 'borderStyle',
        'borderRadius', 'opacity', 'cursor',
    ] as const) {
        const value = paint[key];
        if (value !== undefined && !Array.isArray(value) && typeof value !== 'object') out[key] = value;
    }
    for (const key of [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
        'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform', 'whiteSpace', 'textOverflow',
    ] as const) {
        const value = text[key];
        if (value !== undefined) out[key] = value;
    }
    if (layout.position) out.position = layout.position;
    for (const key of ['top', 'right', 'bottom', 'left', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
        const value = layout[key];
        if (typeof value === 'number') out[key] = value;
    }
    if (typeof layout.width === 'number') out.width = layout.width;
    if (typeof layout.height === 'number') out.height = layout.height;
    return out;
}

function normalizeAlign(value: string): string {
    if (value === 'flex-start') return 'start';
    if (value === 'flex-end') return 'end';
    return value;
}
