import { assignAnchors, type PreAnchorIRNode } from '../../anchors.js';
import { normalizeCssColor } from '../../css-color.js';
import { parseObservedBackgroundLayers } from './gradient.js';
import type {
    Confidence,
    IRNode,
    SourceFormat,
    TypedLayout,
    TypedPaint,
    TypedText,
    TextRun,
    TypedInteraction,
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
    interactionEvidence?: ObservedInteractionEvidence;
    usedFonts?: Array<{ family: string; postScriptName: string; custom: boolean; glyphCount: number }>;
}

export interface ObservedInteractionEvidence {
    enabled: boolean;
    role?: string;
    accessibleName?: string;
    listeners: Array<{ type: string; handlerLocation?: string }>;
    react?: { componentName?: string; sourceLocation?: string; propNames: string[] };
    activation?: {
        stateChanged: boolean;
        navigationChanged: boolean;
        ipc: Array<{ channel: string; direction: 'send' | 'invoke' }>;
        changedAttributes: string[];
    };
}

export type ObservedDomContent =
    | { kind: 'text'; text: string; rect?: { x: number; y: number; width: number; height: number } }
    | { kind: 'child'; sourceId: string };

export interface ObservedDomLowerOptions {
    applicationActions?: readonly string[];
    selectedStateAttributes?: readonly string[];
}

interface BuildNode extends PreAnchorIRNode {
    source: ObservedDomNode;
    layout?: TypedLayout;
    paint?: TypedPaint;
    textStyle?: TypedText;
    textRuns?: TextRun[];
    interaction?: TypedInteraction;
    confidence: Confidence;
    children: BuildNode[];
}

export interface ObservedStyleDiagnostic {
    property: string;
    value: string;
    code: 'css-color-unsupported' | 'css-color-invalid' | 'css-length-unsupported'
        | 'css-shadow-unsupported' | 'css-background-image-unsupported'
        | 'css-transform-unsupported' | 'css-filter-unsupported'
        | 'css-backdrop-filter-unsupported' | 'css-overflow-unsupported'
        | 'css-number-unsupported' | 'css-keyword-unsupported' | 'css-cursor-unsupported';
}

export function lowerObservedDom(root: ObservedDomNode, capturedAt: string,
                                 options: ObservedDomLowerOptions = {}): IRNode {
    return lowerObservedDomWithLayoutReport(root, capturedAt, 0.5, options).root;
}

function expandAtomicInlineContent(source: ObservedDomNode): ObservedDomNode {
    const children = source.children.map(expandAtomicInlineContent);
    const byId = new Map(children.map((child) => [child.sourceId, child]));
    const content = source.content;
    if (!content?.some((item) => item.kind === 'text' && item.text !== '') ||
        !content.some((item) => item.kind === 'child' && isAtomicInline(byId.get(item.sourceId)!)))
        return { ...source, children };
    const nowrap = source.computedStyle.whiteSpace === 'nowrap' ||
        (['flex', 'inline-flex'].includes(source.computedStyle.display) &&
         (!source.computedStyle.flexWrap || source.computedStyle.flexWrap === 'nowrap'));
    if (!nowrap)
        throw new Error(`observed DOM node ${source.sourceId} mixed inline wrapping is unsupported`);
    const orderedChildren: ObservedDomNode[] = [];
    const orderedContent: ObservedDomContent[] = [];
    content.forEach((item, index) => {
        if (item.kind === 'child') {
            const child = byId.get(item.sourceId)!;
            orderedChildren.push(child);
            orderedContent.push(item);
            return;
        }
        if (item.text === '') return;
        // A zero-area composite has no observable inline fragment geometry.
        // Preserve its durable text child with the parent's exact zero-area
        // rect so responsive union identity remains stable; visible composites
        // still fail closed when the capture omitted required text geometry.
        const textRect = item.rect ?? ((source.rect.width <= 0 || source.rect.height <= 0)
            ? source.rect : undefined);
        if (!textRect)
            throw new Error(`observed DOM node ${source.sourceId} mixed inline text requires captured geometry`);
        const sourceId = `${source.sourceId}::text:${index}`;
        orderedChildren.push({
            sourceId,
            tagName: 'span',
            text: item.text,
            attributes: {},
            computedStyle: { ...source.computedStyle, display: 'inline' },
            rect: textRect,
            children: [],
        });
        orderedContent.push({ kind: 'child', sourceId });
    });
    return {
        ...source,
        attributes: source.tagName.toLowerCase() === 'button'
            ? source.attributes
            : { ...(source.attributes ?? {}), 'data-pulp-inline-composite': 'true' },
        computedStyle: { ...source.computedStyle, display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' },
        children: orderedChildren,
        content: orderedContent,
    };
}

function isAtomicInline(node: ObservedDomNode | undefined): boolean {
    if (!node) return false;
    return ['svg', 'img'].includes(node.tagName.toLowerCase()) ||
        ['inline-block', 'inline-flex'].includes(node.computedStyle.display);
}

export function lowerObservedDomWithLayoutReport(
    root: ObservedDomNode,
    capturedAt: string,
    geometryTolerance = 0.5,
    options: ObservedDomLowerOptions = {},
): { root: IRNode; layoutReport: DisplayCapabilityReport } {
    root = expandAtomicInlineContent(root);
    validate(root, new Set());
    const layoutReport = classifyObservedDomLayout(root, geometryTolerance);
    const entries = new Map(layoutReport.entries.map((entry) => [entry.sourceId, entry]));
    const built = build(root, entries, options);
    const anchors = assignAnchors(built, 'adapter');
    const materialized = materialize(built, anchors, capturedAt, true);
    markObservedViewportFill(materialized, root.rect);
    return { root: materialized, layoutReport };
}

function markObservedViewportFill(node: IRNode, viewport: ObservedDomNode['rect']): void {
    if (node.raw_source.kind === 'observed-dom') {
        const rect = (node.raw_source.node as ObservedDomNode).rect;
        if (Math.abs(rect.x - viewport.x) <= 0.5 && Math.abs(rect.y - viewport.y) <= 0.5 &&
            Math.abs(rect.width - viewport.width) <= 0.5 && Math.abs(rect.height - viewport.height) <= 0.5)
            node.meta = { ...(node.meta ?? {}), observed_viewport_fill: true };
    }
    node.children.forEach((child) => markObservedViewportFill(child, viewport));
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
    if (node.content.some((item) => item.kind === 'text' && item.text.trim() !== '') &&
        !isInlineTextContainer(node) && node.tagName.toLowerCase() !== 'button' &&
        !canLowerDirectTextLeaf(node)) {
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
    options: ObservedDomLowerOptions,
): BuildNode {
    const capability = entries.get(source.sourceId);
    if (!capability) throw new Error(`missing layout capability for ${source.sourceId}`);
    const role = source.attributes?.role ?? implicitRole(source.tagName);
    const attributed = attributedText(source);
    const textValue = attributed?.text ?? leafText(source);
    const attributes = source.attributes ?? {};
    const interaction = observedInteraction(source, options);
    const inlinePointerEvents = source.attributes?.style?.match(/(?:^|;)\s*pointer-events\s*:\s*([^;]+)/i)?.[1]?.trim();
    const pointerEvents = source.computedStyle.pointerEvents || inlinePointerEvents;
    if (pointerEvents && pointerEvents !== 'auto' && pointerEvents !== 'none')
        throw new Error(`observed DOM node ${source.sourceId} has unsupported pointer-events: ${pointerEvents}`);
    const paintResult = paint(source.computedStyle);
    const layersResult = parseObservedBackgroundLayers(source.computedStyle.backgroundImage);
    const gradientResult = {
        value: layersResult.value?.length === 1 ? layersResult.value[0] : undefined,
        diagnostic: layersResult.diagnostic,
    };
    if (layersResult.value && layersResult.value.length > 0) {
        paintResult.value = { ...paintResult.value, backgroundLayers: layersResult.value };
        paintResult.diagnostics = paintResult.diagnostics.filter((item) =>
            !(item.code === 'css-background-image-unsupported' && item.property === 'backgroundImage'));
    }
    if (source.computedStyle.backgroundImage === 'none')
        paintResult.value = { ...paintResult.value, backgroundLayers: [] };
    if (gradientResult.value) {
        paintResult.value = { ...paintResult.value, backgroundGradient: gradientResult.value };
        paintResult.diagnostics = paintResult.diagnostics.filter((item) =>
            !(item.code === 'css-background-image-unsupported' && item.property === 'backgroundImage'));
    }
    const layoutResult = layout(source.computedStyle, source.rect);
    const typographyDiagnostics = source.computedStyle.letterSpacing &&
        trackedSpacing(source.computedStyle.letterSpacing) === undefined
        ? [styleDiagnostic('css-length-unsupported', 'letterSpacing', source.computedStyle.letterSpacing)]
        : [];
    if (source.computedStyle.lineHeight && trackedLineHeight(source.computedStyle.lineHeight) === undefined)
        typographyDiagnostics.push(styleDiagnostic('css-length-unsupported', 'lineHeight', source.computedStyle.lineHeight));
    const supportedOverflowWrap = ['normal', 'break-word', 'anywhere'];
    if (source.computedStyle.overflowWrap && !supportedOverflowWrap.includes(source.computedStyle.overflowWrap))
        typographyDiagnostics.push(styleDiagnostic('css-overflow-wrap-unsupported', 'overflowWrap', source.computedStyle.overflowWrap));
    if (source.computedStyle.wordWrap && !['normal', 'break-word'].includes(source.computedStyle.wordWrap))
        typographyDiagnostics.push(styleDiagnostic('css-overflow-wrap-unsupported', 'wordWrap', source.computedStyle.wordWrap));
    const colorDiagnostics = paintResult.diagnostics.filter((item) =>
        item.code === 'css-color-unsupported' || item.code === 'css-color-invalid');
    const observedVisualStates = Object.fromEntries(Object.entries(source.stateStyles ?? {}).map(([state, style]) => {
        const statePaint = paint(style!);
        return [state, {
            paint: statePaint.value,
            text: typography(style!, textValue),
            layout: layout(style!, source.rect).value,
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
        ...(pointerEvents === 'none' ? { pointer_events: 'none' } : {}),
        ...(colorDiagnostics.length > 0 ? { css_color_diagnostics: colorDiagnostics } : {}),
        ...(gradientResult.diagnostic ? { css_gradient_diagnostics: [gradientResult.diagnostic] } : {}),
        ...(gradientResult.value && isPromotedWidget(source)
            ? { css_gradient_loss_policy: 'native-widget-chrome-may-override-background' }
            : {}),
        ...([...paintResult.diagnostics, ...layoutResult.diagnostics, ...typographyDiagnostics].length > 0
            ? { observed_style_diagnostics: [...paintResult.diagnostics, ...layoutResult.diagnostics, ...typographyDiagnostics] }
            : {}),
        ...(Object.keys(observedVisualStates).length > 0
            ? { observed_visual_states: observedVisualStates }
            : {}),
        ...(source.usedFonts?.length ? { runtime_used_fonts: source.usedFonts } : {}),
    };
    const children = attributed ? [] : source.children.map((child) => build(child, entries, options));
    if (capability.capability === 'block-simple') {
        const margins = resolveColumnFlexChildMargins(source);
        children.forEach((child, index) => {
            child.layout = { ...child.layout, ...margins[index], width: undefined, alignSelf: 'stretch' };
        });
    }
    return {
        tag: textValue && children.length === 0 && !interaction && !isPromotedWidget(source)
            ? 'Label'
            : nativeTag(source.tagName, source.attributes, interaction?.selected),
        source_node_id: source.sourceId,
        _adapter: OBSERVED_DOM_ADAPTER_NAME,
        source,
        layout: loweredLayoutFor(source, capability, layoutResult.value),
        paint: paintResult.value,
        text: textValue ? { text: textValue } : undefined,
        textStyle: textValue || textBearing(source.tagName)
            ? typography(source.computedStyle, textValue)
            : undefined,
        textRuns: attributed?.runs,
        interaction,
        meta: Object.keys(meta).length === 0 ? undefined : meta,
        confidence: capability.capability === 'unsupported' ||
                    paintResult.diagnostics.length > 0 || layoutResult.diagnostics.length > 0 || typographyDiagnostics.length > 0 ||
                    gradientResult.diagnostic !== undefined ||
                    (gradientResult.value !== undefined && isPromotedWidget(source))
            ? 'DIVERGE'
            : 'PASS',
        children,
    };
}

function isPromotedWidget(node: ObservedDomNode): boolean {
    return ['button', 'input', 'textarea', 'select'].includes(node.tagName.toLowerCase()) ||
        ['button', 'combobox', 'textbox'].includes(node.attributes?.role ?? '');
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
        interaction: node.interaction,
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

function nativeTag(tag: string, attrs: Record<string, string> | undefined,
                   selected: boolean | undefined): string {
    if (attrs?.['data-pulp-inline-composite'] === 'true') return 'View';
    const lower = tag.toLowerCase();
    if (selected !== undefined || attrs?.['aria-pressed'] !== undefined) return 'ToggleButton';
    if (lower === 'button' || attrs?.role === 'button') return 'Button';
    if (lower === 'textarea' || lower === 'input') return 'TextEditor';
    if (lower === 'img') return 'Image';
    if (lower === 'svg') return 'Icon';
    if (['span', 'p', 'h1', 'h2', 'h3', 'label', 'code', 'pre'].includes(lower)) return 'Label';
    if (attrs?.role === 'dialog') return 'Modal';
    return 'View';
}

function observedInteraction(node: ObservedDomNode,
                             options: ObservedDomLowerOptions): TypedInteraction | undefined {
    const attributes = node.attributes ?? {};
    const actionBindingId = attributes['data-pulp-action'] ?? '';
    const required = attributes['data-pulp-action-required'] === 'true';
    if (required && (!actionBindingId || !options.applicationActions?.includes(actionBindingId))) {
        throw new Error(`observed DOM node ${node.sourceId} requires unknown application action: ${actionBindingId || '<empty>'}`);
    }
    const selected = observedSelected(attributes, options.selectedStateAttributes ?? []);
    if (!actionBindingId && selected === undefined) return undefined;
    const event = attributes['data-pulp-event'] ?? (node.tagName.toLowerCase() === 'input' ? 'input' : 'click');
    if (!['click', 'change', 'input', 'key'].includes(event))
        throw new Error(`observed DOM node ${node.sourceId} has unsupported action event: ${event}`);
    const tabIndex = attributes.tabindex === undefined ? undefined : Number(attributes.tabindex);
    if (tabIndex !== undefined && !Number.isInteger(tabIndex))
        throw new Error(`observed DOM node ${node.sourceId} has invalid tabindex`);
    return {
        actionBindingId,
        event: event as TypedInteraction['event'],
        ...(attributes['data-pulp-payload-contract']
            ? { payloadContract: attributes['data-pulp-payload-contract'] }
            : {}),
        required,
        disabled: attributes.disabled !== undefined || attributes['aria-disabled'] === 'true',
        focusable: tabIndex !== undefined ? tabIndex >= 0 : true,
        ...(tabIndex !== undefined ? { tabIndex } : {}),
        ...(selected !== undefined ? { selected } : {}),
    };
}

function observedSelected(attributes: Record<string, string>, policy: readonly string[]): boolean | undefined {
    if (attributes['aria-pressed'] !== undefined) return attributes['aria-pressed'] === 'true';
    if (attributes['aria-selected'] !== undefined) return attributes['aria-selected'] === 'true';
    if (['option', 'tab', 'menuitemradio'].includes(attributes.role ?? ''))
        return attributes['aria-checked'] === 'true' || attributes['aria-selected'] === 'true';
    for (const name of policy) {
        if (attributes[name] !== undefined)
            return attributes[name] === '' || attributes[name] === 'true' || attributes[name] === 'active' || attributes[name] === 'selected';
    }
    return undefined;
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
    const captured = node.content?.filter((item): item is Extract<ObservedDomContent, { kind: 'text' }> => item.kind === 'text')
        .map((item) => item.text).join('');
    const value = captured ?? node.text ?? '';
    if (['pre', 'pre-wrap', 'break-spaces'].includes(node.computedStyle.whiteSpace ?? ''))
        return value;
    return value.replace(/\s+/g, ' ').trim();
}

function canLowerDirectTextLeaf(node: ObservedDomNode): boolean {
    return node.children.length === 0 &&
        ['div', 'span', 'label', 'p', 'h1', 'h2', 'h3', 'pre', 'code', 'kbd'].includes(node.tagName.toLowerCase());
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
        ...(trackedSpacing(style.letterSpacing) !== undefined ? { letterSpacing: trackedSpacing(style.letterSpacing) } : {}),
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

function trackedSpacing(value: string | undefined): number | undefined {
    return value === 'normal' ? 0 : px(value);
}

function trackedLineHeight(value: string | undefined): number | undefined {
    return value === 'normal' ? 0 : px(value);
}

function cssLength(value: string | undefined): TypedLayout['width'] | undefined {
    if (!value) return undefined;
    if (value === 'auto') return value;
    const pixels = px(value);
    if (pixels !== undefined) return pixels;
    if (/^-?(?:\d+|\d*\.\d+)(?:%|vw|vh|vmin|vmax)$/.test(value))
        return value as TypedLayout['width'];
    if (/^calc\(\s*-?(?:\d+|\d*\.\d+)%\s*[+-]\s*(?:\d+|\d*\.\d+)px\s*\)$/.test(value))
        return value as TypedLayout['width'];
    return undefined;
}

function cssLengthList(value: string | undefined): NonNullable<TypedLayout['width']>[] | undefined {
    if (!value || value === 'normal') return undefined;
    const tokens = value.trim().match(/calc\([^)]*\)|[^\s]+/g) ?? [];
    const values = tokens.map(cssLength);
    return values.every((item) => item !== undefined) ? values as NonNullable<TypedLayout['width']>[] : undefined;
}

function expandFour<T>(values: T[]): [T, T, T, T] {
    if (values.length === 1) return [values[0], values[0], values[0], values[0]];
    if (values.length === 2) return [values[0], values[1], values[0], values[1]];
    if (values.length === 3) return [values[0], values[1], values[2], values[1]];
    return [values[0], values[1], values[2], values[3]];
}

function styleDiagnostic(code: ObservedStyleDiagnostic['code'], property: string,
                         value: string): ObservedStyleDiagnostic {
    return { code, property, value };
}

function splitCssList(value: string): string[] {
    const parts: string[] = [];
    let depth = 0, start = 0;
    for (let index = 0; index < value.length; index++) {
        if (value[index] === '(') depth++;
        else if (value[index] === ')') depth--;
        else if (value[index] === ',' && depth === 0) {
            parts.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(value.slice(start).trim());
    return parts;
}

function parseBoxShadows(value: string): NonNullable<TypedPaint['boxShadow']> | undefined {
    const shadows: NonNullable<TypedPaint['boxShadow']> = [];
    for (const part of splitCssList(value)) {
        const match = part.match(/^(inset\s+)?(.+?)\s+(-?(?:\d+|\d*\.\d+)px)\s+(-?(?:\d+|\d*\.\d+)px)(?:\s+((?:\d+|\d*\.\d+)px))?(?:\s+(-?(?:\d+|\d*\.\d+)px))?$/);
        if (!match) return undefined;
        const color = normalizeCssColor(match[2]);
        if (!color.value) return undefined;
        shadows.push({
            offsetX: px(match[3])!, offsetY: px(match[4])!,
            blur: px(match[5]) ?? 0, spread: px(match[6]) ?? 0,
            color: color.value, ...(match[1] ? { inset: true } : {}),
        });
    }
    return shadows;
}

function parseFilterFns(value: string): NonNullable<TypedPaint['filter']> | undefined {
    const out: NonNullable<TypedPaint['filter']> = [];
    let consumed = '';
    for (const match of value.matchAll(/([a-z-]+)\(([^()]*)\)/g)) {
        consumed += match[0];
        const fn = match[1];
        const arg = match[2].trim();
        const amount = arg.endsWith('%') ? Number(arg.slice(0, -1)) / 100 : Number(arg);
        if (fn === 'blur' && arg.endsWith('px')) out.push({ fn, px: Number(arg.slice(0, -2)) });
        else if (fn === 'hue-rotate' && arg.endsWith('deg')) out.push({ fn, deg: Number(arg.slice(0, -3)) });
        else if (['brightness', 'contrast', 'grayscale', 'sepia', 'invert', 'saturate', 'opacity'].includes(fn) && Number.isFinite(amount))
            out.push({ fn, amount } as NonNullable<TypedPaint['filter']>[number]);
        else return undefined;
    }
    if (consumed === '' || consumed !== value.replace(/\s+/g, '')) return undefined;
    return out;
}

function layout(style: Record<string, string>, rect: ObservedDomNode['rect']): {
    value: TypedLayout; diagnostics: ObservedStyleDiagnostic[];
} {
    const out: TypedLayout = {
        display: style.display || 'flex',
        width: rect.width,
        height: style.height === 'auto' ? 'auto' : rect.height,
    };
    const diagnostics: ObservedStyleDiagnostic[] = [];
    if (style.flexDirection) out.flexDirection = style.flexDirection as TypedLayout['flexDirection'];
    if (style.flexWrap) out.flexWrap = style.flexWrap as TypedLayout['flexWrap'];
    if (style.alignItems === 'normal') {
        out.alignItems = style.display === 'inline' || style.display === 'inline-block'
            ? 'flex-start' : 'stretch';
    } else if (style.alignItems) {
        out.alignItems = style.alignItems as TypedLayout['alignItems'];
    }
    if (style.alignSelf) out.alignSelf = style.alignSelf as TypedLayout['alignSelf'];
    if (style.justifyContent === 'normal') {
        // CSS Box Alignment resolves normal to start for flex containers. The
        // importer lowers simple block flow to column flex, where the same
        // start-position equivalence preserves observed normal-flow geometry.
        out.justifyContent = 'flex-start';
    } else if (style.justifyContent) {
        const supported = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'];
        if (supported.includes(style.justifyContent))
            out.justifyContent = style.justifyContent as TypedLayout['justifyContent'];
        else diagnostics.push(styleDiagnostic('css-keyword-unsupported', 'justifyContent', style.justifyContent));
    }
    for (const key of ['flexGrow', 'flexShrink'] as const) {
        const value = Number(style[key]);
        if (Number.isFinite(value) && value >= 0) out[key] = value;
        else if (style[key]) diagnostics.push(styleDiagnostic('css-number-unsupported', key, style[key]));
    }
    const basis = cssLength(style.flexBasis);
    if (basis !== undefined) out.flexBasis = basis;
    else if (style.flexBasis && style.flexBasis !== 'normal')
        diagnostics.push(styleDiagnostic('css-length-unsupported', 'flexBasis', style.flexBasis));
    const margins = cssLengthList(style.margin);
    if (margins?.length && margins.length <= 4 && margins.every((value): value is number => typeof value === 'number')) {
        const [top, right, bottom, left] = expandFour(margins);
        out.marginTop = top; out.marginRight = right; out.marginBottom = bottom; out.marginLeft = left;
    } else if (style.margin) {
        diagnostics.push(styleDiagnostic('css-length-unsupported', 'margin', style.margin));
    }
    for (const [source, target] of [
        ['rowGap', 'rowGap'], ['columnGap', 'columnGap'],
        ['marginTop', 'marginTop'], ['marginRight', 'marginRight'],
        ['marginBottom', 'marginBottom'], ['marginLeft', 'marginLeft'],
    ] as const) {
        const value = px(style[source]);
        if (value !== undefined) (out as Record<string, unknown>)[target] = value;
    }
    const paddingTokens = cssLengthList(style.padding);
    const validPadding = (value: TypedLayout['padding']) => value !== undefined && value !== 'auto' &&
        (typeof value !== 'number' || value >= 0) &&
        (typeof value !== 'string' || !value.startsWith('-'));
    if (paddingTokens && paddingTokens.length >= 1 && paddingTokens.length <= 4 && paddingTokens.every(validPadding)) {
        const [top, right, bottom, left] = expandFour(paddingTokens);
        Object.assign(out, { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left });
    } else if (style.padding)
        diagnostics.push(styleDiagnostic('css-padding-unsupported', 'padding', style.padding));
    for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
        const original = style[key];
        if (!original) continue;
        const value = cssLength(original);
        if (validPadding(value)) out[key] = value;
        else diagnostics.push(styleDiagnostic('css-padding-unsupported', key, original));
    }
    if (style.boxSizing) {
        if (style.boxSizing === 'content-box' || style.boxSizing === 'border-box') out.boxSizing = style.boxSizing;
        else diagnostics.push(styleDiagnostic('css-box-sizing-unsupported', 'boxSizing', style.boxSizing));
    }
    const gaps = cssLengthList(style.gap);
    const validGaps = gaps?.every((value) => typeof value === 'number' && value >= 0) ? gaps : undefined;
    if (validGaps?.length === 1) out.gap = validGaps[0];
    else if (validGaps?.length === 2) { out.rowGap = validGaps[0]; out.columnGap = validGaps[1]; }
    else if (style.gap && style.gap !== 'normal')
        diagnostics.push(styleDiagnostic('css-length-unsupported', 'gap', style.gap));
    for (const key of ['position'] as const) {
        const value = style[key] as TypedLayout[typeof key] | undefined;
        if (value && ['static', 'relative', 'absolute', 'fixed'].includes(value)) out[key] = value;
        else if (value) diagnostics.push(styleDiagnostic('css-position-unsupported', key, value));
    }
    for (const key of ['top', 'right', 'bottom', 'left', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
        const original = style[key];
        const value = cssLength(original);
        if (value !== undefined) {
            out[key] = value;
            const nativeMinMaxLength = typeof value === 'string' &&
                (/^-?(?:\d+|\d*\.\d+)%$/.test(value) ||
                 /^calc\(\s*-?(?:\d+|\d*\.\d+)%\s*[+-]\s*(?:\d+|\d*\.\d+)px\s*\)$/.test(value));
            if (value !== 'auto' && typeof value !== 'number' && !nativeMinMaxLength)
                diagnostics.push(styleDiagnostic('css-length-unsupported', key, original));
        }
        else if (original && original !== 'none')
            diagnostics.push(styleDiagnostic('css-length-unsupported', key, original));
    }
    for (const key of ['overflowX', 'overflowY'] as const) {
        const value = style[key];
        if (!value) continue;
        if (['visible', 'hidden', 'clip', 'scroll', 'auto'].includes(value))
            out[key] = value as TypedLayout[typeof key];
        else diagnostics.push(styleDiagnostic('css-overflow-unsupported', key, value));
    }
    return { value: out, diagnostics };
}

function paint(style: Record<string, string>): {
    value?: TypedPaint;
    diagnostics: ObservedStyleDiagnostic[];
} {
    const out: TypedPaint = {};
    const diagnostics: ObservedStyleDiagnostic[] = [];
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
    for (const key of ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'] as const) {
        const value = px(style[key]);
        if (value !== undefined) out[key] = value;
    }
    const sideWidths = [out.borderTopWidth, out.borderRightWidth, out.borderBottomWidth, out.borderLeftWidth];
    if (out.borderWidth === undefined && sideWidths.every((value) => typeof value === 'number') &&
        sideWidths.every((value) => value === sideWidths[0])) out.borderWidth = sideWidths[0];
    const sideColors = [out.borderTopColor, out.borderRightColor, out.borderBottomColor, out.borderLeftColor];
    if (out.borderColor === undefined && sideColors.every((value) => typeof value === 'string') &&
        sideColors.every((value) => value === sideColors[0])) out.borderColor = sideColors[0];
    const radii = cssLengthList(style.borderRadius);
    if (radii?.length === 1 && typeof radii[0] === 'number') out.borderRadius = radii[0];
    if (radii && radii.length > 1 && radii.every((value): value is number => typeof value === 'number')) {
        const [topLeft, topRight, bottomRight, bottomLeft] = expandFour(radii);
        out.borderTopLeftRadius = topLeft;
        out.borderTopRightRadius = topRight;
        out.borderBottomRightRadius = bottomRight;
        out.borderBottomLeftRadius = bottomLeft;
    } else if (style.borderRadius && !radii) {
        diagnostics.push(styleDiagnostic('css-length-unsupported', 'borderRadius', style.borderRadius));
    }
    for (const [source, target] of [
        ['borderTopLeftRadius', 'borderTopLeftRadius'], ['borderTopRightRadius', 'borderTopRightRadius'],
        ['borderBottomRightRadius', 'borderBottomRightRadius'], ['borderBottomLeftRadius', 'borderBottomLeftRadius'],
    ] as const) {
        const value = px(style[source]);
        if (value !== undefined) out[target] = value;
    }
    if (style.cursor) {
        const supported = ['auto', 'default', 'pointer', 'text', 'crosshair', 'grab', 'grabbing', 'not-allowed'];
        if (supported.includes(style.cursor)) out.cursor = style.cursor as TypedPaint['cursor'];
        else diagnostics.push(styleDiagnostic('css-cursor-unsupported', 'cursor', style.cursor));
    }
    if (style.boxShadow === 'none') out.boxShadow = [];
    else if (style.boxShadow) {
        const shadows = parseBoxShadows(style.boxShadow);
        if (shadows) out.boxShadow = shadows;
        else diagnostics.push(styleDiagnostic('css-shadow-unsupported', 'boxShadow', style.boxShadow));
    }
    const opacity = Number(style.opacity);
    if (style.opacity !== undefined) {
        if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) {
            if (opacity !== 1) out.opacity = opacity;
        } else diagnostics.push(styleDiagnostic('css-opacity-unsupported', 'opacity', style.opacity));
    }
    if (style.backdropFilter === 'none') out.backdropFilter = [];
    if (style.filter === 'none') out.filter = [];
    else if (style.filter) {
        const filters = parseFilterFns(style.filter);
        if (filters) out.filter = filters;
        else diagnostics.push(styleDiagnostic('css-filter-unsupported', 'filter', style.filter));
    }
    for (const [property, code] of [
        ['backgroundImage', 'css-background-image-unsupported'],
        ['transform', 'css-transform-unsupported'],
        ['backdropFilter', 'css-backdrop-filter-unsupported'],
    ] as const) {
        const value = style[property];
        if (value && value !== 'none') diagnostics.push(styleDiagnostic(code, property, value));
    }
    return { value: Object.keys(out).length === 0 ? undefined : out, diagnostics };
}

function typography(style: Record<string, string>, text: string): TypedText {
    const weight = Number(style.fontWeight);
    return {
        text,
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        ...(px(style.fontSize) !== undefined ? { fontSize: px(style.fontSize) } : {}),
        ...(Number.isFinite(weight) ? { fontWeight: weight } : {}),
        ...(trackedLineHeight(style.lineHeight) !== undefined ? { lineHeight: trackedLineHeight(style.lineHeight) } : {}),
        ...(trackedSpacing(style.letterSpacing) !== undefined ? { letterSpacing: trackedSpacing(style.letterSpacing) } : {}),
        ...(style.textAlign ? { textAlign: style.textAlign as TypedText['textAlign'] } : {}),
        ...(style.whiteSpace ? { whiteSpace: style.whiteSpace as TypedText['whiteSpace'] } : {}),
        ...(style.textOverflow ? { textOverflow: style.textOverflow as TypedText['textOverflow'] } : {}),
        ...(['normal', 'break-word', 'anywhere'].includes(style.overflowWrap)
            ? { overflowWrap: style.overflowWrap as TypedText['overflowWrap'] } : {}),
        ...(['normal', 'break-word'].includes(style.wordWrap)
            ? { wordWrap: style.wordWrap as TypedText['wordWrap'] } : {}),
    };
}
