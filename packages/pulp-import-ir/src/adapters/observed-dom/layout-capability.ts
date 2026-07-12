import type { TypedLayout } from '../../types.js';

export type DisplayCapability = 'direct' | 'block-simple' | 'inline-text' | 'unsupported';

export interface LayoutDiagnostic {
    code: 'layout-unsupported' | 'layout-geometry-diverged';
    sourceId: string;
    display: string;
    reason: string;
}

export interface GeometryOracleResult {
    tolerance: number;
    maxDelta: number;
    matches: boolean;
}

export interface DisplayCapabilityEntry {
    sourceId: string;
    display: string;
    position: string;
    float: string;
    clear: string;
    capability: DisplayCapability;
    lowering: 'direct' | 'column-flex' | 'attributed-text' | 'observed-geometry-projection';
    geometryOracle?: GeometryOracleResult;
    diagnostics: LayoutDiagnostic[];
}

export interface LayoutObservedNode {
    sourceId: string;
    tagName: string;
    text?: string;
    computedStyle: Record<string, string>;
    rect: { x: number; y: number; width: number; height: number };
    children: LayoutObservedNode[];
}

export interface DisplayCapabilityReport {
    version: 1;
    geometryTolerance: number;
    entries: DisplayCapabilityEntry[];
    diagnostics: LayoutDiagnostic[];
}

const blockDisplays = new Set(['block', 'flow-root', 'list-item']);
const inlineDisplays = new Set(['inline', 'inline-block']);
const atomicTags = new Set(['button', 'img', 'input', 'select', 'textarea', 'svg', 'canvas']);

export function classifyObservedDomLayout(
    root: LayoutObservedNode,
    geometryTolerance = 0.5,
): DisplayCapabilityReport {
    if (!Number.isFinite(geometryTolerance) || geometryTolerance < 0) {
        throw new Error('geometry tolerance must be a finite non-negative number');
    }
    const entries: DisplayCapabilityEntry[] = [];
    visit(root, geometryTolerance, entries);
    return {
        version: 1,
        geometryTolerance,
        entries,
        diagnostics: entries.flatMap((entry) => entry.diagnostics),
    };
}

export function loweredLayoutFor(
    node: LayoutObservedNode,
    entry: DisplayCapabilityEntry,
    base: TypedLayout,
): TypedLayout {
    if (entry.capability !== 'block-simple') return base;
    return { ...base, display: 'flex', flexDirection: 'column' };
}

export function resolveColumnFlexChildMargins(node: LayoutObservedNode): Array<{
    marginTop: number;
    marginBottom: number;
}> {
    let previousBottom = 0;
    return node.children.map((child) => {
        if (child.rect.width <= 0 || child.rect.height <= 0)
            return { marginTop: 0, marginBottom: 0 };
        const marginTop = collapseMargins(previousBottom, px(child.computedStyle.marginTop));
        previousBottom = px(child.computedStyle.marginBottom);
        return { marginTop, marginBottom: 0 };
    });
}

function visit(
    node: LayoutObservedNode,
    tolerance: number,
    entries: DisplayCapabilityEntry[],
): void {
    const display = normalized(node.computedStyle.display, 'block');
    const position = normalized(node.computedStyle.position, 'static');
    const cssFloat = normalized(node.computedStyle.cssFloat ?? node.computedStyle.float, 'none');
    const clear = normalized(node.computedStyle.clear, 'none');
    const reasons = unsupportedReasons(node, display, cssFloat);
    let capability: DisplayCapability;
    let lowering: DisplayCapabilityEntry['lowering'];
    let geometryOracle: GeometryOracleResult | undefined;

    if (reasons.length !== 0) {
        capability = 'unsupported';
        lowering = 'observed-geometry-projection';
    } else if (['flex', 'inline-flex', 'grid', 'none', 'contents'].includes(display)) {
        capability = 'direct';
        lowering = 'direct';
    } else if (isInlineTextContainer(node, display)) {
        capability = 'inline-text';
        lowering = 'attributed-text';
    } else if (blockDisplays.has(display) && hasSimpleBlockChildren(node)) {
        geometryOracle = blockGeometryOracle(node, tolerance);
        if (geometryOracle.matches) {
            capability = 'block-simple';
            lowering = 'column-flex';
        } else {
            capability = 'unsupported';
            lowering = 'observed-geometry-projection';
            reasons.push(`column-flex geometry differs by ${geometryOracle.maxDelta}px`);
        }
    } else {
        capability = 'unsupported';
        lowering = 'observed-geometry-projection';
        reasons.push(`display:${display} does not have a safe native lowering`);
    }

    const diagnostics: LayoutDiagnostic[] = reasons.map((reason) => ({
        code: reason.startsWith('column-flex geometry')
            ? 'layout-geometry-diverged'
            : 'layout-unsupported',
        sourceId: node.sourceId,
        display,
        reason,
    }));
    entries.push({
        sourceId: node.sourceId,
        display,
        position,
        float: cssFloat,
        clear,
        capability,
        lowering,
        ...(geometryOracle ? { geometryOracle } : {}),
        diagnostics,
    });
    for (const child of node.children) visit(child, tolerance, entries);
}

function unsupportedReasons(node: LayoutObservedNode, display: string, cssFloat: string): string[] {
    const reasons: string[] = [];
    if (cssFloat !== 'none') reasons.push(`float:${cssFloat} requires wrap-around layout`);
    if (display === 'table' || display.startsWith('table-')) reasons.push(`display:${display} requires table layout`);
    const columns = normalized(node.computedStyle.columnCount, 'auto');
    const columnWidth = normalized(node.computedStyle.columnWidth, 'auto');
    if ((columns !== 'auto' && columns !== '1') || columnWidth !== 'auto') {
        reasons.push('multi-column flow is unsupported');
    }
    if (hasMixedInlineFlow(node)) reasons.push('mixed inline flow with embedded boxes is unsupported');
    return reasons;
}

function isInlineTextContainer(node: LayoutObservedNode, display: string): boolean {
    if (!['block', 'inline'].includes(display)) return false;
    if (node.children.length === 0) {
        return display === 'inline'
            && !atomicTags.has(node.tagName.toLowerCase())
            && Boolean(node.text?.trim());
    }
    return node.children.every(isInlineTextNode);
}

function isInlineTextNode(node: LayoutObservedNode): boolean {
    const display = normalized(node.computedStyle.display, 'inline');
    return !atomicTags.has(node.tagName.toLowerCase())
        && display === 'inline'
        && node.children.every(isInlineTextNode);
}

function hasMixedInlineFlow(node: LayoutObservedNode): boolean {
    const inline = node.children.filter((child) => inlineDisplays.has(normalized(child.computedStyle.display, 'inline')));
    if (inline.length === 0) return false;
    return inline.some((child) => atomicTags.has(child.tagName.toLowerCase()))
        || inline.length !== node.children.length;
}

function hasSimpleBlockChildren(node: LayoutObservedNode): boolean {
    if (node.children.length === 0) return true;
    return node.children.every((child) => {
        if (normalized(child.computedStyle.position, 'static') !== 'static') return false;
        const display = normalized(child.computedStyle.display, 'inline');
        if (blockDisplays.has(display) || ['flex', 'grid'].includes(display)) return true;
        if (!atomicTags.has(child.tagName.toLowerCase()) || !inlineDisplays.has(display)) return false;
        return occupiesOwnLine(node, child);
    });
}

function occupiesOwnLine(parent: LayoutObservedNode, child: LayoutObservedNode): boolean {
    const left = parent.rect.x + px(parent.computedStyle.paddingLeft);
    const right = parent.rect.x + parent.rect.width - px(parent.computedStyle.paddingRight);
    return Math.abs(child.rect.x - left) <= 0.5 && Math.abs(child.rect.x + child.rect.width - right) <= 0.5;
}

function blockGeometryOracle(node: LayoutObservedNode, tolerance: number): GeometryOracleResult {
    if (node.children.length === 0) return { tolerance, maxDelta: 0, matches: true };
    let cursor = node.rect.y + px(node.computedStyle.paddingTop);
    let previousBottomMargin = 0;
    let maxDelta = 0;
    for (const child of node.children) {
        // DOMSnapshot gives non-rendered live regions and similar empty nodes
        // a zero-area fallback rect (often at 0,0). They neither paint nor
        // advance CSS block flow, so they are not geometry-oracle samples.
        if (child.rect.width <= 0 || child.rect.height <= 0) continue;
        const topMargin = px(child.computedStyle.marginTop);
        const collapsed = collapseMargins(previousBottomMargin, topMargin);
        const predictedY = cursor + collapsed;
        maxDelta = Math.max(maxDelta, Math.abs(predictedY - child.rect.y));
        const marginLeft = px(child.computedStyle.marginLeft);
        const marginRight = px(child.computedStyle.marginRight);
        const predictedX = node.rect.x + px(node.computedStyle.paddingLeft) + marginLeft;
        const predictedWidth = node.rect.width - px(node.computedStyle.paddingLeft)
            - px(node.computedStyle.paddingRight) - marginLeft - marginRight;
        maxDelta = Math.max(maxDelta, Math.abs(predictedX - child.rect.x));
        maxDelta = Math.max(maxDelta, Math.abs(predictedWidth - child.rect.width));
        cursor = child.rect.y + child.rect.height;
        previousBottomMargin = px(child.computedStyle.marginBottom);
    }
    return { tolerance, maxDelta, matches: maxDelta <= tolerance };
}

function collapseMargins(a: number, b: number): number {
    if (a >= 0 && b >= 0) return Math.max(a, b);
    if (a <= 0 && b <= 0) return Math.min(a, b);
    return a + b;
}

function normalized(value: string | undefined, fallback: string): string {
    const result = value?.trim().toLowerCase();
    return result || fallback;
}

function px(value: string | undefined): number {
    if (!value) return 0;
    const parsed = Number(value.endsWith('px') ? value.slice(0, -2) : value);
    return Number.isFinite(parsed) ? parsed : 0;
}
