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
    if (node.interaction) {
        attributes.action_binding_id = node.interaction.actionBindingId;
        attributes.pulpRouteId = node.meta?.semantic_id ?? node.source_node_id ?? node.stable_anchor_id;
        attributes.pulpHostAction = node.interaction.actionBindingId;
        attributes.pulpEventContract = node.interaction.event;
        if (node.interaction.payloadContract) attributes.pulpPayloadContract = node.interaction.payloadContract;
        attributes.disabled = String(node.interaction.disabled);
        attributes.focusable = String(node.interaction.focusable);
        if (node.interaction.tabIndex !== undefined) attributes.tabIndex = String(node.interaction.tabIndex);
        if (node.interaction.selected !== undefined) attributes.selected = String(node.interaction.selected);
    }
    if (sourceRevision) attributes.source_revision = sourceRevision;
    const inlineSvg = node.source_node_id ? svg.documents.get(node.source_node_id) : undefined;
    const visualSkin = nativeVisualSkin(node);
    return {
        type: nativeType(node.tag),
        name: node.meta?.semantic_id ?? node.source_node_id ?? node.tag,
        ...(node.text?.text ? { content: node.text.text } : {}),
        ...(node.textRuns && node.textRuns.length > 0 ? { textRuns: node.textRuns } : {}),
        layout: nativeLayout(node),
        style: nativeStyle(node),
        ...(visualSkin ? { visualSkin } : {}),
        ...(node.token_refs ? { token_refs: node.token_refs } : {}),
        ...(node.responsive ? { responsive: node.responsive } : {}),
        attributes,
        stable_anchor_id: node.stable_anchor_id,
        anchor_strategy: 'adapter',
        source_node_id: node.source_node_id ?? '',
        source_adapter: node.provenance.adapter,
        source_version: node.provenance.version,
        confidence: node.confidence.toLowerCase(),
        raw_source: JSON.stringify(node.raw_source),
        ...(inlineSvg ? { render_mode: 'faithful_svg', svg_asset_id: inlineSvg.assetId } : {}),
        ...(inlineSvg && node.interaction?.actionBindingId ? {
            interactiveElements: [{
                kind: 'action',
                x: 0, y: 0,
                w: typeof node.layout?.width === 'number' ? node.layout.width : 0,
                h: typeof node.layout?.height === 'number' ? node.layout.height : 0,
                action: node.interaction.actionBindingId,
                source_node_id: node.source_node_id ?? '',
            }],
        } : {}),
        children: node.children.map((child) => nodeToNative(child, sourceRevision, svg)),
    };
}

function nativeVisualSkin(node: IRNode): Record<string, unknown> | undefined {
    const kind = nativeType(node.tag);
    if (!new Set(['button', 'toggle_button', 'text_editor', 'scroll_view', 'checkbox', 'combo_box']).has(kind))
        return undefined;
    const rest = nativeVisualState(node.paint, node.text, node.layout);
    const captured = node.meta?.observed_visual_states as Record<string, {
        paint?: IRNode['paint']; text?: IRNode['text']; layout?: IRNode['layout'];
    }> | undefined;
    const states: Record<string, unknown> = { rest };
    for (const [state, value] of Object.entries(captured ?? {}))
        states[state] = nativeVisualState(value.paint, value.text, value.layout);
    return { states, tokenRefs: {} };
}

function nativeVisualState(paint: IRNode['paint'], text: IRNode['text'], layout: IRNode['layout']): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const background = skinColor(paint?.backgroundColor);
    const foreground = skinColor(paint?.color);
    const border = skinColor(paint?.borderColor);
    if (background) out.background = background;
    if (foreground) out.foreground = foreground;
    if (border) out.border = border;
    if (typeof paint?.borderWidth === 'number') out.borderWidth = paint.borderWidth;
    if (typeof paint?.borderRadius === 'number') out.cornerRadius = paint.borderRadius;
    if (typeof text?.fontSize === 'number') out.fontSize = text.fontSize;
    if (typeof text?.letterSpacing === 'number') out.letterSpacing = text.letterSpacing;
    if (typeof text?.lineHeight === 'number') out.lineHeight = text.lineHeight;
    if (typeof text?.fontFamily === 'string') out.fontFamily = text.fontFamily;
    if (typeof text?.fontWeight === 'number') out.fontWeight = text.fontWeight;
    else if (text?.fontWeight === 'bold') out.fontWeight = 700;
    else if (text?.fontWeight === 'normal') out.fontWeight = 400;
    const align = text?.textAlign;
    if (align === 'left') out.textAlign = 0;
    else if (align === 'right') out.textAlign = 2;
    else if (align === 'center') out.textAlign = 1;
    if (layout?.paddingLeft === layout?.paddingRight && typeof layout?.paddingLeft === 'number')
        out.insetHorizontal = layout.paddingLeft;
    if (layout?.paddingTop === layout?.paddingBottom && typeof layout?.paddingTop === 'number')
        out.insetVertical = layout.paddingTop;
    return out;
}

function skinColor(value: unknown): { r: number; g: number; b: number; a: number } | undefined {
    if (typeof value !== 'string' || !/^#[0-9a-f]{8}$/i.test(value)) return undefined;
    return {
        r: Number.parseInt(value.slice(1, 3), 16),
        g: Number.parseInt(value.slice(3, 5), 16),
        b: Number.parseInt(value.slice(5, 7), 16),
        a: Number.parseInt(value.slice(7, 9), 16),
    };
}

function nativeType(tag: string): string {
    const lower = tag.toLowerCase();
    if (lower === 'texteditor') return 'text_editor';
    if (lower === 'togglebutton') return 'toggle_button';
    if (lower === 'scrollview') return 'scroll_view';
    if (lower === 'combobox') return 'combo_box';
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
    if (node.meta?.observed_viewport_fill === true) {
        out.widthMode = 'fill';
        out.heightMode = 'fill';
    } else if (typeof value.width === 'number') {
        out.widthMode = 'fixed';
        out.width = value.width;
    }
    if (node.meta?.observed_viewport_fill !== true && typeof value.height === 'number') {
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
        'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
        'borderBottomRightRadius', 'borderBottomLeftRadius', 'opacity', 'cursor',
    ] as const) {
        const value = paint[key];
        if (value !== undefined && !Array.isArray(value) && typeof value !== 'object') out[key] = value;
    }
    if (paint.boxShadow) {
        out.boxShadow = paint.boxShadow.length === 0 ? 'none' : paint.boxShadow.map((shadow) =>
            `${shadow.inset ? 'inset ' : ''}${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.spread ?? 0}px ${shadow.color}`
        ).join(', ');
    }
    if (paint.backdropFilter) {
        out.backdropFilter = paint.backdropFilter.length === 0
            ? 'none'
            : paint.backdropFilter.map((filter) => filter.fn === 'blur'
                ? `blur(${filter.px}px)` : filter.fn).join(' ');
    }
    if (paint.backgroundGradient) out.backgroundGradient = paint.backgroundGradient.css;
    if (paint.backgroundLayers) out.backgroundLayers = paint.backgroundLayers.map((layer) => layer.css);
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
    if (layout.bottom === 'auto') out.bottomAuto = true;
    // CSS `flex-basis:auto` explicitly consults the main-size property. Treat
    // it like an absent basis so fixed-width icons retain their observed width.
    // A concrete basis (`0%`, pixels, etc.) still owns the initial main size.
    const basisOwnsWidth = layout.flexBasis !== undefined && layout.flexBasis !== 'auto';
    if (node.meta?.observed_viewport_fill !== true && typeof layout.width === 'number' && !(layout.flexGrow && layout.flexGrow > 0) && !basisOwnsWidth)
        out.width = layout.width;
    if (node.meta?.observed_viewport_fill !== true && typeof layout.height === 'number') out.height = layout.height;
    return out;
}

function normalizeAlign(value: string): string {
    if (value === 'flex-start') return 'start';
    if (value === 'flex-end') return 'end';
    return value;
}
