import { assignAnchors, type PreAnchorIRNode } from '../../anchors.js';
import { normalizeCssColor } from '../../css-color.js';
import type {
    Confidence,
    IRNode,
    SourceFormat,
    TypedLayout,
    TypedPaint,
    TypedText,
    TextRun,
} from '../../types.js';
import {
    classifyObservedDomLayout,
    loweredLayoutFor,
    resolveColumnFlexChildMargins,
    type DisplayCapabilityReport,
} from './layout-capability.js';

export const OBSERVED_DOM_ADAPTER_NAME = 'observed-dom';
export const OBSERVED_DOM_ADAPTER_VERSION = '1.0.0';

export interface ObservedDomNode {
    sourceId: string;
    tagName: string;
    text?: string;
    attributes?: Record<string, string>;
    computedStyle: Record<string, string>;
    stateStyles?: Partial<Record<'hover' | 'pressed' | 'focused' | 'selected' | 'disabled' | 'active', Record<string, string>>>;
    rect: { x: number; y: number; width: number; height: number };
    children: ObservedDomNode[];
    content?: ObservedDomContent[];
}

export type ObservedDomContent =
    | { kind: 'text'; text: string }
    | { kind: 'child'; sourceId: string };

interface BuildNode extends PreAnchorIRNode {
    source: ObservedDomNode;
    layout?: TypedLayout;
    paint?: TypedPaint;
    textStyle?: TypedText;
    textRuns?: TextRun[];
    confidence: Confidence;
    children: BuildNode[];
}

export function lowerObservedDom(root: ObservedDomNode, capturedAt: string): IRNode {
    return lowerObservedDomWithLayoutReport(root, capturedAt).root;
}

export function lowerObservedDomWithLayoutReport(
    root: ObservedDomNode,
    capturedAt: string,
    geometryTolerance = 0.5,
): { root: IRNode; layoutReport: DisplayCapabilityReport } {
    validate(root, new Set());
    const layoutReport = classifyObservedDomLayout(root, geometryTolerance);
    const entries = new Map(layoutReport.entries.map((entry) => [entry.sourceId, entry]));
    const built = build(root, entries);
    const anchors = assignAnchors(built, 'adapter');
    return { root: materialize(built, anchors, capturedAt, true), layoutReport };
}

function validate(node: ObservedDomNode, ids: Set<string>): void {
    if (!node.sourceId || ids.has(node.sourceId)) {
        throw new Error(`observed DOM sourceId must be non-empty and unique: ${node.sourceId}`);
    }
    ids.add(node.sourceId);
    if (!node.tagName || !Number.isFinite(node.rect.width) || !Number.isFinite(node.rect.height)) {
        throw new Error(`observed DOM node ${node.sourceId} has invalid geometry or tag`);
    }
    validateContent(node);
    for (const child of node.children) validate(child, ids);
}

function validateContent(node: ObservedDomNode): void {
    if (!node.content) {
        if (node.children.length > 0 && node.text !== undefined && node.text !== '') {
            throw new Error(`observed DOM node ${node.sourceId} has ambiguous legacy mixed text; ordered content is required`);
        }
        return;
    }
    if (node.text !== undefined) {
        throw new Error(`observed DOM node ${node.sourceId} cannot combine legacy text with ordered content`);
    }
    for (const item of node.content) {
        if (item.kind === 'text' && typeof item.text === 'string') continue;
        if (item.kind === 'child' && typeof item.sourceId === 'string' && item.sourceId !== '') continue;
        throw new Error(`observed DOM node ${node.sourceId} has malformed ordered content`);
    }
    if (node.content.some((item) => item.kind === 'text' && item.text !== '') && !isInlineTextContainer(node)) {
        throw new Error(`observed DOM node ${node.sourceId} cannot lower ordered text outside an inline-text container`);
    }
    const expected = node.children.map((child) => child.sourceId);
    const observed = node.content
        .filter((item): item is Extract<ObservedDomContent, { kind: 'child' }> => item.kind === 'child')
        .map((item) => item.sourceId);
    if (observed.length !== expected.length || observed.some((id, index) => id !== expected[index])) {
        throw new Error(`observed DOM node ${node.sourceId} ordered content must reference every child exactly once in child order`);
    }
}

function build(
    source: ObservedDomNode,
    entries: Map<string, DisplayCapabilityReport['entries'][number]>,
): BuildNode {
    const capability = entries.get(source.sourceId);
    if (!capability) throw new Error(`missing layout capability for ${source.sourceId}`);
    const role = source.attributes?.role ?? implicitRole(source.tagName);
    const attributed = attributedText(source);
    const textValue = attributed?.text ?? leafText(source);
    const attributes = source.attributes ?? {};
    const paintResult = paint(source.computedStyle);
    const observedVisualStates = Object.fromEntries(Object.entries(source.stateStyles ?? {}).map(([state, style]) => {
        const statePaint = paint(style!);
        return [state, {
            paint: statePaint.value,
            text: typography(style!, textValue),
            layout: layout(style!, source.rect),
        }];
    }));
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
        ...(paintResult.diagnostics.length > 0
            ? { css_color_diagnostics: paintResult.diagnostics }
            : {}),
        ...(Object.keys(observedVisualStates).length > 0
            ? { observed_visual_states: observedVisualStates }
            : {}),
    };
    const children = attributed ? [] : source.children.map((child) => build(child, entries));
    if (capability.capability === 'block-simple') {
        const margins = resolveColumnFlexChildMargins(source);
        children.forEach((child, index) => {
            child.layout = { ...child.layout, ...margins[index] };
        });
    }
    return {
        tag: nativeTag(source.tagName, source.attributes),
        source_node_id: source.sourceId,
        _adapter: OBSERVED_DOM_ADAPTER_NAME,
        source,
        layout: loweredLayoutFor(source, capability, layout(source.computedStyle, source.rect)),
        paint: paintResult.value,
        text: textValue ? { text: textValue } : undefined,
        textStyle: textValue || textBearing(source.tagName)
            ? typography(source.computedStyle, textValue)
            : undefined,
        textRuns: attributed?.runs,
        meta: Object.keys(meta).length === 0 ? undefined : meta,
        confidence: capability.capability === 'unsupported' || paintResult.diagnostics.length > 0
            ? 'DIVERGE'
            : 'PASS',
        children,
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
        textRuns: node.textRuns,
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

function attributedText(node: ObservedDomNode): { text: string; runs: TextRun[] } | undefined {
    if (!node.content || !isInlineTextContainer(node)) return undefined;
    let text = '';
    const runs: TextRun[] = [];
    const children = new Map(node.children.map((child) => [child.sourceId, child]));
    const append = (value: string, source: ObservedDomNode) => {
        const normalized = normalizeText(value, source);
        if (!normalized) return;
        const start = utf8Length(text);
        text += normalized;
        const end = utf8Length(text);
        runs.push(textRun(source, start, end));
    };
    const walk = (source: ObservedDomNode) => {
        if (source.content) {
            const byId = new Map(source.children.map((child) => [child.sourceId, child]));
            for (const item of source.content) {
                if (item.kind === 'text') append(item.text, source);
                else walk(byId.get(item.sourceId)!);
            }
        } else {
            append(source.text ?? '', source);
        }
    };
    for (const item of node.content) {
        if (item.kind === 'text') append(item.text, node);
        else walk(children.get(item.sourceId)!);
    }
    return { text, runs };
}

function utf8Length(value: string): number {
    return new TextEncoder().encode(value).length;
}

function isInlineTextContainer(node: ObservedDomNode): boolean {
    const tags = new Set(['p', 'span', 'label', 'button', 'h1', 'h2', 'h3', 'pre', 'code']);
    const inlineTags = new Set(['span', 'code', 'strong', 'b', 'em', 'i']);
    return tags.has(node.tagName.toLowerCase()) && node.children.every((child) => {
        const display = child.computedStyle.display;
        return inlineTags.has(child.tagName.toLowerCase()) &&
            (display === 'inline' || display === 'contents' || display === undefined);
    });
}

function normalizeText(value: string, node: ObservedDomNode): string {
    const whiteSpace = node.computedStyle.whiteSpace;
    if (node.tagName.toLowerCase() === 'pre' || whiteSpace === 'pre' || whiteSpace === 'pre-wrap') return value;
    return value.replace(/\s+/g, ' ');
}

function textRun(node: ObservedDomNode, start: number, end: number): TextRun {
    const style = node.computedStyle;
    const weight = Number(style.fontWeight);
    const color = style.color ? normalizeCssColor(style.color) : undefined;
    return {
        start,
        end,
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        ...(px(style.fontSize) !== undefined ? { fontSize: px(style.fontSize) } : {}),
        ...(Number.isFinite(weight) ? { fontWeight: weight } : {}),
        ...(style.fontStyle ? { fontStyle: style.fontStyle as TextRun['fontStyle'] } : {}),
        ...(color?.value ? { color: color.value } : {}),
        ...(px(style.letterSpacing) !== undefined ? { letterSpacing: px(style.letterSpacing) } : {}),
        ...(style.textDecorationLine === 'underline' || style.textDecorationLine === 'line-through'
            ? { textDecoration: style.textDecorationLine }
            : {}),
        ...(node.tagName.toLowerCase() === 'code' ? { semanticKind: 'inline_code' as const } : {}),
    };
}

function textBearing(tag: string): boolean {
    return ['textarea', 'input', 'button', 'label'].includes(tag.toLowerCase());
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

interface CssColorDiagnostic {
    property: string;
    value: string;
    code: 'css-color-unsupported' | 'css-color-invalid';
}

function paint(style: Record<string, string>): {
    value?: TypedPaint;
    diagnostics: CssColorDiagnostic[];
} {
    const out: TypedPaint = {};
    const diagnostics: CssColorDiagnostic[] = [];
    for (const [source, target] of [
        ['backgroundColor', 'backgroundColor'],
        ['color', 'color'],
        ['borderColor', 'borderColor'],
        ['borderTopColor', 'borderTopColor'],
        ['borderRightColor', 'borderRightColor'],
        ['borderBottomColor', 'borderBottomColor'],
        ['borderLeftColor', 'borderLeftColor'],
    ] as const) {
        const original = style[source];
        if (!original) continue;
        const normalized = normalizeCssColor(original);
        if (normalized.diagnostic) {
            diagnostics.push({ property: source, value: original, code: normalized.diagnostic });
        } else if (normalized.value) {
            out[target] = normalized.value;
        }
    }
    const borderWidth = px(style.borderWidth);
    if (borderWidth !== undefined) out.borderWidth = borderWidth;
    const radius = px(style.borderRadius);
    if (radius !== undefined) out.borderRadius = radius;
    const opacity = Number(style.opacity);
    if (Number.isFinite(opacity) && opacity !== 1) out.opacity = opacity;
    return { value: Object.keys(out).length === 0 ? undefined : out, diagnostics };
}

function typography(style: Record<string, string>, text: string): TypedText {
    const weight = Number(style.fontWeight);
    return {
        text,
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        ...(px(style.fontSize) !== undefined ? { fontSize: px(style.fontSize) } : {}),
        ...(Number.isFinite(weight) ? { fontWeight: weight } : {}),
        ...(px(style.lineHeight) !== undefined ? { lineHeight: px(style.lineHeight) } : {}),
        ...(px(style.letterSpacing) !== undefined ? { letterSpacing: px(style.letterSpacing) } : {}),
        ...(style.textAlign ? { textAlign: style.textAlign as TypedText['textAlign'] } : {}),
        ...(style.whiteSpace ? { whiteSpace: style.whiteSpace as TypedText['whiteSpace'] } : {}),
    };
}
