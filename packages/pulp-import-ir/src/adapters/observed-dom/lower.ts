import { assignAnchors, type PreAnchorIRNode } from '../../anchors.js';
import type {
    Confidence,
    IRNode,
    SourceFormat,
    TypedLayout,
    TypedPaint,
    TypedText,
} from '../../types.js';

export const OBSERVED_DOM_ADAPTER_NAME = 'observed-dom';
export const OBSERVED_DOM_ADAPTER_VERSION = '1.0.0';

export interface ObservedDomNode {
    sourceId: string;
    tagName: string;
    text?: string;
    attributes?: Record<string, string>;
    computedStyle: Record<string, string>;
    rect: { x: number; y: number; width: number; height: number };
    children: ObservedDomNode[];
}

interface BuildNode extends PreAnchorIRNode {
    source: ObservedDomNode;
    layout?: TypedLayout;
    paint?: TypedPaint;
    textStyle?: TypedText;
    confidence: Confidence;
    children: BuildNode[];
}

export function lowerObservedDom(root: ObservedDomNode, capturedAt: string): IRNode {
    validate(root, new Set());
    const built = build(root);
    const anchors = assignAnchors(built, 'adapter');
    return materialize(built, anchors, capturedAt, true);
}

function validate(node: ObservedDomNode, ids: Set<string>): void {
    if (!node.sourceId || ids.has(node.sourceId)) {
        throw new Error(`observed DOM sourceId must be non-empty and unique: ${node.sourceId}`);
    }
    ids.add(node.sourceId);
    if (!node.tagName || !Number.isFinite(node.rect.width) || !Number.isFinite(node.rect.height)) {
        throw new Error(`observed DOM node ${node.sourceId} has invalid geometry or tag`);
    }
    for (const child of node.children) validate(child, ids);
}

function build(source: ObservedDomNode): BuildNode {
    const role = source.attributes?.role ?? implicitRole(source.tagName);
    const textValue = leafText(source);
    const attributes = source.attributes ?? {};
    const meta = {
        ...(role ? { role } : {}),
        ...(attributes['data-pulp-semantic-id']
            ? { semantic_id: attributes['data-pulp-semantic-id'] }
            : {}),
        ...(attributes['aria-label'] ? { accessibility_name: attributes['aria-label'] } : {}),
        ...(attributes['data-pulp-action']
            ? { action_binding_id: attributes['data-pulp-action'] }
            : {}),
        ...(attributes['data-pulp-list-key']
            ? { keyed_list_identity: attributes['data-pulp-list-key'] }
            : {}),
    };
    return {
        tag: nativeTag(source.tagName, source.attributes),
        source_node_id: source.sourceId,
        _adapter: OBSERVED_DOM_ADAPTER_NAME,
        source,
        layout: layout(source.computedStyle, source.rect),
        paint: paint(source.computedStyle),
        text: textValue ? { text: textValue } : undefined,
        textStyle: textValue ? typography(source.computedStyle, textValue) : undefined,
        meta: Object.keys(meta).length === 0 ? undefined : meta,
        confidence: supportedDisplay(source.computedStyle.display) ? 'PASS' : 'DIVERGE',
        children: source.children.map(build),
    };
}

function materialize(
    node: BuildNode,
    anchors: Map<BuildNode, string>,
    capturedAt: string,
    root: boolean,
): IRNode {
    const anchor = anchors.get(node);
    if (!anchor) throw new Error(`missing observed DOM anchor for ${node.source.sourceId}`);
    const raw: SourceFormat = {
        kind: 'observed-dom',
        node: {
            sourceId: node.source.sourceId,
            tagName: node.source.tagName,
            attributes: node.source.attributes ?? {},
            rect: node.source.rect,
        },
        computedStyle: node.source.computedStyle,
    };
    return {
        tag: node.tag,
        stable_anchor_id: anchor,
        source_node_id: node.source.sourceId,
        layout: node.layout,
        paint: node.paint,
        text: node.textStyle,
        children: node.children.map((child) => materialize(child, anchors, capturedAt, false)),
        meta: node.meta,
        provenance: {
            adapter: OBSERVED_DOM_ADAPTER_NAME,
            version: OBSERVED_DOM_ADAPTER_VERSION,
            ts: capturedAt,
            ...(root ? { imported_at: capturedAt, last_seen_at: capturedAt } : {}),
        },
        raw_source: raw,
        confidence: node.confidence,
    };
}

function nativeTag(tag: string, attrs: Record<string, string> | undefined): string {
    const lower = tag.toLowerCase();
    if (lower === 'button' || attrs?.role === 'button') return 'Button';
    if (lower === 'textarea' || lower === 'input') return 'TextEditor';
    if (lower === 'img') return 'Image';
    if (lower === 'svg') return 'Icon';
    if (['span', 'p', 'h1', 'h2', 'h3', 'label', 'code', 'pre'].includes(lower)) return 'Label';
    if (attrs?.role === 'dialog') return 'Modal';
    return 'View';
}

function implicitRole(tag: string): string | undefined {
    const lower = tag.toLowerCase();
    if (lower === 'button') return 'button';
    if (lower === 'textarea' || lower === 'input') return 'textbox';
    if (lower === 'img') return 'img';
    return undefined;
}

function leafText(node: ObservedDomNode): string {
    if (node.children.length !== 0) return '';
    return (node.text ?? '').replace(/\s+/g, ' ').trim();
}

function px(value: string | undefined): number | undefined {
    if (!value || !value.endsWith('px')) return undefined;
    const parsed = Number(value.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : undefined;
}

function layout(style: Record<string, string>, rect: ObservedDomNode['rect']): TypedLayout {
    const out: TypedLayout = {
        display: style.display || 'flex',
        width: rect.width,
        height: rect.height,
    };
    if (style.flexDirection) out.flexDirection = style.flexDirection as TypedLayout['flexDirection'];
    if (style.flexWrap) out.flexWrap = style.flexWrap as TypedLayout['flexWrap'];
    if (style.alignItems) out.alignItems = style.alignItems as TypedLayout['alignItems'];
    if (style.justifyContent) out.justifyContent = style.justifyContent as TypedLayout['justifyContent'];
    for (const [source, target] of [
        ['gap', 'gap'], ['rowGap', 'rowGap'], ['columnGap', 'columnGap'],
        ['paddingTop', 'paddingTop'], ['paddingRight', 'paddingRight'],
        ['paddingBottom', 'paddingBottom'], ['paddingLeft', 'paddingLeft'],
        ['marginTop', 'marginTop'], ['marginRight', 'marginRight'],
        ['marginBottom', 'marginBottom'], ['marginLeft', 'marginLeft'],
    ] as const) {
        const value = px(style[source]);
        if (value !== undefined) (out as Record<string, unknown>)[target] = value;
    }
    if (style.overflowX) out.overflowX = style.overflowX as TypedLayout['overflowX'];
    if (style.overflowY) out.overflowY = style.overflowY as TypedLayout['overflowY'];
    return out;
}

function paint(style: Record<string, string>): TypedPaint | undefined {
    const out: TypedPaint = {};
    if (visibleColor(style.backgroundColor)) out.backgroundColor = style.backgroundColor;
    if (visibleColor(style.color)) out.color = style.color;
    if (visibleColor(style.borderColor)) out.borderColor = style.borderColor;
    const borderWidth = px(style.borderWidth);
    if (borderWidth !== undefined) out.borderWidth = borderWidth;
    const radius = px(style.borderRadius);
    if (radius !== undefined) out.borderRadius = radius;
    const opacity = Number(style.opacity);
    if (Number.isFinite(opacity) && opacity !== 1) out.opacity = opacity;
    return Object.keys(out).length === 0 ? undefined : out;
}

function typography(style: Record<string, string>, text: string): TypedText {
    const weight = Number(style.fontWeight);
    return {
        text,
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        ...(px(style.fontSize) !== undefined ? { fontSize: px(style.fontSize) } : {}),
        ...(Number.isFinite(weight) ? { fontWeight: weight } : {}),
        ...(px(style.lineHeight) !== undefined ? { lineHeight: px(style.lineHeight) } : {}),
        ...(style.textAlign ? { textAlign: style.textAlign as TypedText['textAlign'] } : {}),
        ...(style.whiteSpace ? { whiteSpace: style.whiteSpace as TypedText['whiteSpace'] } : {}),
    };
}

function visibleColor(value: string | undefined): boolean {
    return Boolean(value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent');
}

function supportedDisplay(value: string | undefined): boolean {
    return !value || ['flex', 'inline-flex', 'none', 'contents'].includes(value);
}
