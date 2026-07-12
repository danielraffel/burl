import type { IRNode } from './types.js';
import type { ObservedDomNode } from './adapters/observed-dom/lower.js';

export interface ResponsiveCapture { viewport: { width: number; height: number }; root: ObservedDomNode }
export type ResponsiveAxisKind = 'fixed' | 'fill' | 'proportional' | 'min' | 'max' | 'clamp';
export interface ResponsiveAxisConstraint {
    kind: ResponsiveAxisKind;
    ratio?: number;
    offset?: number;
    value?: number;
    min?: number;
    max?: number;
    residual: number;
}
export interface ResponsiveBreakpointInterval { lowerBound: number; upperBound: number; confidence: 'bounded' | 'measured' | 'authored' }
export interface ResponsiveVisibilityVariant { visible: boolean; structural: boolean; transitionToNext?: ResponsiveBreakpointInterval }
export interface ResponsiveLayoutVariant {
    flexDirection?: string;
    flexWrap?: string;
    reflowed: boolean;
    transitionToNext?: ResponsiveBreakpointInterval;
}
export interface TypedResponsiveConstraints {
    horizontal: ResponsiveAxisConstraint;
    vertical: ResponsiveAxisConstraint;
    visibility: ResponsiveVisibilityVariant[];
    layoutVariants: ResponsiveLayoutVariant[];
    sampledViewports: number[];
}
export interface ResponsiveDiagnostic { sourceId: string; code: 'ambiguous-axis' | 'non-monotonic-visibility' | 'bounded-breakpoint'; message: string }
export interface ResponsiveMatchReport { matched: number; structuralVariants: number; unmatched: number; ambiguous: number }
export interface ResponsiveReconciliation { constraints: Map<string, TypedResponsiveConstraints>; diagnostics: ResponsiveDiagnostic[]; matchReport: ResponsiveMatchReport }

interface Sample { viewport: number; node: ObservedDomNode; parent?: ObservedDomNode }
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const rms = (actual: number[], predicted: number[]) => Math.sqrt(mean(actual.map((v, i) => (v - predicted[i]) ** 2)));
const rounded = (n: number) => Math.round(n * 10000) / 10000;

function linear(xs: number[], ys: number[]): { ratio: number; offset: number; residual: number } {
    const mx = mean(xs), my = mean(ys);
    const denominator = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
    if (denominator < 0.001) return { ratio: 0, offset: my, residual: rms(ys, ys.map(() => my)) };
    const ratio = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / denominator;
    const offset = my - ratio * mx;
    return { ratio, offset, residual: rms(ys, xs.map((x) => ratio * x + offset)) };
}

function inferAxis(sourceId: string, samples: Sample[], axis: 'horizontal' | 'vertical'): ResponsiveAxisConstraint {
    const size = samples.map(({ node }) => axis === 'horizontal' ? node.rect.width : node.rect.height);
    const container = samples.map(({ parent, viewport }) => parent
        ? (axis === 'horizontal' ? parent.rect.width : parent.rect.height)
        : (axis === 'horizontal' ? viewport : samples[0].node.rect.height));
    const fixed = { kind: 'fixed' as const, value: mean(size), residual: rms(size, size.map(() => mean(size))) };
    const fit = linear(container, size);
    const range = Math.max(...size) - Math.min(...size);
    if (fixed.residual <= 0.5) return { ...fixed, value: rounded(fixed.value), residual: rounded(fixed.residual) };
    if (Math.abs(fit.ratio - 1) <= 0.03 && fit.residual <= 1)
        return { kind: 'fill', offset: rounded(fit.offset), residual: rounded(fit.residual) };
    if (fit.residual <= 1 && fit.ratio > 0.02) {
        const sorted = [...samples.keys()].sort((a, b) => container[a] - container[b]);
        const low = size[sorted[0]], mid = size[sorted[Math.floor(sorted.length / 2)]], high = size[sorted.at(-1)!];
        if (Math.abs(low - mid) <= 0.5 && range > 1)
            return { kind: 'min', min: rounded(low), ratio: rounded(fit.ratio), offset: rounded(fit.offset), residual: rounded(fit.residual) };
        if (Math.abs(mid - high) <= 0.5 && range > 1)
            return { kind: 'max', max: rounded(high), ratio: rounded(fit.ratio), offset: rounded(fit.offset), residual: rounded(fit.residual) };
        return { kind: 'proportional', ratio: rounded(fit.ratio), offset: rounded(fit.offset), residual: rounded(fit.residual) };
    }
    // A bounded linear model is useful only when it materially improves the fit.
    const predicted = container.map((value) => Math.max(Math.min(fit.ratio * value + fit.offset, Math.max(...size)), Math.min(...size)));
    const clampResidual = rms(size, predicted);
    if (clampResidual <= 1)
        return { kind: 'clamp', min: rounded(Math.min(...size)), max: rounded(Math.max(...size)), ratio: rounded(fit.ratio), offset: rounded(fit.offset), residual: rounded(clampResidual) };
    throw new Error(`responsive axis is ambiguous for ${sourceId}/${axis}: best residual ${Math.min(fixed.residual, fit.residual, clampResidual).toFixed(3)}px`);
}

function visibility(ordered: Array<Sample | undefined>, viewports: number[]): ResponsiveVisibilityVariant[] {
    const visible = ordered.map((sample) => !!sample && sample.node.computedStyle.display !== 'none' && sample.node.rect.width > 0 && sample.node.rect.height > 0);
    const variants: ResponsiveVisibilityVariant[] = [];
    let start = 0;
    for (let i = 1; i <= ordered.length; i++) if (i === ordered.length || visible[i] !== visible[start]) {
        variants.push({ visible: visible[start], structural: ordered.slice(start, i).some((sample) => !sample) });
        if (i < ordered.length) variants.at(-1)!.transitionToNext = {
            lowerBound: viewports[i - 1], upperBound: viewports[i],
            confidence: viewports[i] - viewports[i - 1] <= 1 ? 'measured' : 'bounded',
        };
        start = i;
    }
    return variants;
}

function layoutVariants(samples: Sample[]): ResponsiveLayoutVariant[] {
    const ordered = [...samples].sort((a, b) => a.viewport - b.viewport);
    const isFlex = (sample: Sample) => ['flex', 'inline-flex'].includes(sample.node.computedStyle.display);
    const key = (sample: Sample) => `${isFlex(sample) ? sample.node.computedStyle.flexDirection ?? '' : ''}|${isFlex(sample) ? sample.node.computedStyle.flexWrap ?? '' : ''}|${reflowed(sample.node)}`;
    const out: ResponsiveLayoutVariant[] = [];
    let start = 0;
    for (let i = 1; i <= ordered.length; i++) if (i === ordered.length || key(ordered[i]) !== key(ordered[start])) {
        out.push({
            ...(isFlex(ordered[start]) ? {
                flexDirection: ordered[start].node.computedStyle.flexDirection,
                flexWrap: ordered[start].node.computedStyle.flexWrap,
            } : {}),
            reflowed: reflowed(ordered[start].node),
        });
        if (i < ordered.length) out.at(-1)!.transitionToNext = {
            lowerBound: ordered[i - 1].viewport, upperBound: ordered[i].viewport,
            confidence: ordered[i].viewport - ordered[i - 1].viewport <= 1 ? 'measured' : 'bounded',
        };
        start = i;
    }
    return out;
}

function reflowed(node: ObservedDomNode): boolean {
    if (node.children.length < 2) return false;
    const rows = new Set(node.children.map((child) => Math.round(child.rect.y * 2) / 2));
    return rows.size > 1 && (node.computedStyle.flexWrap === 'wrap' || node.computedStyle.display === 'block');
}

function flatten(root: ObservedDomNode): { nodes: Map<string, ObservedDomNode>; parents: Map<string, ObservedDomNode> } {
    const nodes = new Map<string, ObservedDomNode>(), parents = new Map<string, ObservedDomNode>();
    const walk = (node: ObservedDomNode, parent?: ObservedDomNode) => {
        if (nodes.has(node.sourceId)) throw new Error(`duplicate responsive sourceId ${node.sourceId}`);
        nodes.set(node.sourceId, node); if (parent) parents.set(node.sourceId, parent);
        node.children.forEach((child) => walk(child, node));
    };
    walk(root); return { nodes, parents };
}

export function reconcileResponsiveConstraints(captures: readonly ResponsiveCapture[]): ResponsiveReconciliation {
    if (captures.length < 3) throw new Error('responsive reconciliation requires at least three viewports');
    const ordered = [...captures].sort((a, b) => a.viewport.width - b.viewport.width);
    if (new Set(ordered.map((capture) => capture.viewport.width)).size !== ordered.length)
        throw new Error('responsive viewport widths must be unique');
    const flattened = ordered.map((capture) => flatten(capture.root));
    const ids = new Set(flattened.flatMap(({ nodes }) => [...nodes.keys()]));
    const constraints = new Map<string, TypedResponsiveConstraints>();
    const diagnostics: ResponsiveDiagnostic[] = [];
    let structuralVariants = 0;
    for (const sourceId of [...ids].sort()) {
        const byViewport: Array<Sample | undefined> = ordered.map((capture, index) => {
            const node = flattened[index].nodes.get(sourceId);
            return node ? { viewport: capture.viewport.width, node, parent: flattened[index].parents.get(sourceId) } : undefined;
        });
        const samples = byViewport.filter((sample): sample is Sample => !!sample);
        const presence = byViewport.map(Boolean);
        const transitions = presence.slice(1).filter((value, index) => value !== presence[index]).length;
        if (transitions > 1) {
            diagnostics.push({ sourceId, code: 'non-monotonic-visibility', message: `structural presence is non-monotonic across ${ordered.map((capture) => capture.viewport.width).join(',')}` });
            continue;
        }
        if (samples.length !== ordered.length) structuralVariants++;
        try {
            const geometrySamples = samples.filter((sample) => sample.node.computedStyle.display !== 'none' && sample.node.rect.width > 0 && sample.node.rect.height > 0);
            if (geometrySamples.length === 0) throw new Error(`responsive node ${sourceId} is hidden in every capture`);
            constraints.set(sourceId, {
                horizontal: inferAxis(sourceId, geometrySamples, 'horizontal'),
                vertical: inferAxis(sourceId, geometrySamples, 'vertical'),
                visibility: visibility(byViewport, ordered.map((capture) => capture.viewport.width)), layoutVariants: layoutVariants(samples),
                sampledViewports: ordered.map((capture) => capture.viewport.width),
            });
        } catch (error) {
            diagnostics.push({ sourceId, code: 'ambiguous-axis', message: String(error) });
        }
        const variants = constraints.get(sourceId)?.visibility ?? [];
        for (const variant of variants) if (variant.transitionToNext?.confidence === 'bounded')
            diagnostics.push({ sourceId, code: 'bounded-breakpoint', message: `breakpoint is bounded to (${variant.transitionToNext.lowerBound}, ${variant.transitionToNext.upperBound}); exact runtime parity requires authored media-query evidence or binary-search capture` });
    }
    return {
        constraints, diagnostics,
        matchReport: {
            matched: constraints.size, structuralVariants,
            unmatched: [...ids].length - constraints.size,
            ambiguous: diagnostics.filter((item) => item.code === 'ambiguous-axis' || item.code === 'non-monotonic-visibility').length,
        },
    };
}

export function applyResponsiveConstraints(root: IRNode, reconciliation: ResponsiveReconciliation): IRNode {
    const walk = (node: IRNode): IRNode => ({
        ...node,
        ...(node.source_node_id && reconciliation.constraints.has(node.source_node_id)
            ? { responsive: reconciliation.constraints.get(node.source_node_id) } : {}),
        children: node.children.map(walk),
    });
    return walk(root);
}

/**
 * Merge structurally alternate viewport trees before responsive constraints are
 * attached. Identity is source-owned; a node that changes parents is rejected
 * because silently cloning or reparenting it would make event/state ownership
 * viewport-history dependent.
 */
export function unionResponsiveTrees(roots: readonly IRNode[], reconciliation: ResponsiveReconciliation): IRNode {
    if (roots.length < 3) throw new Error('responsive structural union requires at least three viewport trees');
    const identity = (node: IRNode): string => node.source_node_id ?? node.stable_anchor_id;
    const parentById = new Map<string, string>();
    const index = (node: IRNode, parent = '') => {
        const id = identity(node);
        const known = parentById.get(id);
        if (known !== undefined && known !== parent)
            throw new Error(`responsive identity ${id} changes parent from ${known} to ${parent}`);
        parentById.set(id, parent);
        node.children.forEach((child) => index(child, id));
    };
    roots.forEach((root) => index(root));
    const rootIds = new Set(roots.map(identity));
    if (rootIds.size !== 1) throw new Error(`responsive roots do not share durable identity: ${[...rootIds].join(',')}`);

    const merge = (variants: readonly IRNode[]): IRNode => {
        const base = variants.at(-1)!;
        const order: string[] = [];
        const children = new Map<string, IRNode[]>();
        for (const variant of variants) for (const child of variant.children) {
            const id = identity(child);
            if (!children.has(id)) { children.set(id, []); order.push(id); }
            children.get(id)!.push(child);
        }
        const mergedChildren = order.map((id) => {
            const branch = children.get(id)!;
            if (branch.length !== variants.length && !reconciliation.constraints.has(id))
                throw new Error(`responsive structural identity ${id} has no proven constraint`);
            return merge(branch);
        });
        const merged: IRNode = { ...base, children: mergedChildren };
        const responsive = reconciliation.constraints.get(identity(merged));
        return responsive ? { ...merged, responsive } : merged;
    };
    return merge(roots);
}
