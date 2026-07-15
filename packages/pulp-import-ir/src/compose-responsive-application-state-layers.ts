import type { IRNode } from './types.js';
import { protectedApplicationStateLocalSemanticIdentity, protectedApplicationStateSemanticIdentity, protectedApplicationStateStableIdentity } from './compose-application-state-dimensions.js';

export interface ResponsiveApplicationStateLayerDimension {
    key: string;
    values: Record<string, IRNode>;
    when?: readonly { key: string; value: string }[];
    whenByValue?: Record<string, readonly { key: string; value: string }[]>;
}

export interface ResponsiveApplicationStateLayerReport {
    dimensions: string[];
    projectedResponsiveRecords: number;
    projectedResponsiveRecordsByLayer: Record<string, number>;
    projectedStateResponsivePatchesByLayer: Record<string, number>;
    insertedStructuralNodes: number;
    insertedStateResponsiveBranches: number;
    projectedStateResponsivePatches: number;
    projectedIntrinsicSizingRecords: number;
    preservedGeneratedTransientOverlays: number;
    repairedOverflowingBaselineAxes: number;
    preservedUnmatchedStateFrontiers: number;
    matchedFrontiers: Record<string, number>;
    matchedAbsentFrontiers: Record<string, number>;
}

const clone = <T>(value: T): T => structuredClone(value);
const stable = (value: unknown): string => JSON.stringify(value, (_key, child) =>
    child && typeof child === 'object' && !Array.isArray(child)
        ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)))
        : child);
const viewportResponsive = (responsive: any): any | undefined => {
    if (!responsive) return undefined;
    const result: any = {};
    for (const key of ['horizontal', 'vertical', 'horizontalVariants', 'verticalVariants',
        'visibility', 'layoutVariants', 'sampledViewports'])
        if (responsive[key] !== undefined) result[key] = clone(responsive[key]);
    return Object.keys(result).length ? result : undefined;
};
const stateScope = (node: IRNode): readonly { key: string; value: string }[] =>
    (node.responsive?.applicationStateWhen ?? []) as readonly { key: string; value: string }[];
const sameScope = (left: readonly { key: string; value: string }[],
    right: readonly { key: string; value: string }[]): boolean => stable(left) === stable(right);
const indexTree = (root: IRNode): Map<string, IRNode[]> => {
    const result = new Map<string, IRNode[]>();
    const visit = (node: IRNode) => {
        const identity = protectedApplicationStateStableIdentity(node);
        result.set(identity, [...(result.get(identity) ?? []), node]);
        node.children.forEach(visit);
    };
    visit(root); return result;
};
const indexSourceIds = (root: IRNode): Map<string, IRNode[]> => {
    const result = new Map<string, IRNode[]>();
    const visit = (node: IRNode) => {
        if (node.source_node_id)
            result.set(node.source_node_id, [...(result.get(node.source_node_id) ?? []), node]);
        node.children.forEach(visit);
    };
    visit(root); return result;
};
const indexSemantic = (root: IRNode): Map<string, IRNode[]> => {
    const result = new Map<string, IRNode[]>();
    const visit = (node: IRNode) => {
        const identity = protectedApplicationStateSemanticIdentity(node);
        result.set(identity, [...(result.get(identity) ?? []), node]);
        node.children.forEach(visit);
    };
    visit(root); return result;
};
const shapePathIdentity = (node: IRNode): string => (node.source_node_id ?? '')
    .replace(/-shape-[0-9a-f]+/g, '-shape')
    .replace(/-id-_r_[^/:]*:\d+/g, '-id-generated:0');
const indexShapePaths = (root: IRNode): Map<string, IRNode[]> => {
    const result = new Map<string, IRNode[]>();
    const visit = (node: IRNode) => {
        const identity = shapePathIdentity(node);
        if (identity) result.set(identity, [...(result.get(identity) ?? []), node]);
        node.children.forEach(visit);
    };
    visit(root); return result;
};
const indexLocalSemantic = (root: IRNode): Map<string, IRNode[]> => {
    const result = new Map<string, IRNode[]>();
    const visit = (node: IRNode) => {
        const identity = protectedApplicationStateLocalSemanticIdentity(node);
        result.set(identity, [...(result.get(identity) ?? []), node]);
        node.children.forEach(visit);
    };
    visit(root); return result;
};
const unique = (index: Map<string, IRNode[]>, identity: string, label: string): IRNode | undefined => {
    const matches = index.get(identity) ?? [];
    if (matches.length > 1) throw new Error(`${label} has ambiguous stable identity ${identity}`);
    return matches[0];
};
const rawRect = (node: IRNode): any => {
    try {
        const raw: any = typeof (node as any).raw_source === 'string'
            ? JSON.parse((node as any).raw_source) : (node as any).raw_source;
        return raw?.node?.rect;
    } catch { return undefined; }
};
const authoredRelativeLayoutValue = (node: IRNode, field: string): string | undefined => {
    let raw: any;
    try {
        raw = typeof (node as any).raw_source === 'string'
            ? JSON.parse((node as any).raw_source) : (node as any).raw_source;
    } catch { return undefined; }
    const classes = String(raw?.node?.attributes?.class ?? '').split(/\s+/);
    if (field === 'marginLeft' && (classes.includes('ml-auto') || classes.includes('mx-auto')))
        return 'auto';
    if (field === 'marginRight' && (classes.includes('mr-auto') || classes.includes('mx-auto')))
        return 'auto';
    if (field === 'marginTop' && (classes.includes('mt-auto') || classes.includes('my-auto')))
        return 'auto';
    if (field === 'marginBottom' && (classes.includes('mb-auto') || classes.includes('my-auto')))
        return 'auto';
    const kebab = field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const winner = raw?.node?.styleProvenanceWinners?.[kebab];
    const authored = typeof winner === 'string' ? winner : winner?.value;
    if (typeof authored !== 'string') return undefined;
    const normalized = authored.trim().toLowerCase();
    if (normalized === 'auto' || normalized.includes('%') ||
        /^(?:calc|min|max|clamp|var)\(/.test(normalized) ||
        /-?(?:\d+|\d*\.\d+)(?:v[wh]|sv[wh]|lv[wh]|dv[wh]|cqw|cqh|cqi|cqb|cqmin|cqmax)$/.test(normalized) ||
        ['fit-content', 'min-content', 'max-content', 'stretch'].includes(normalized))
        return authored.trim();
    return undefined;
};
const uniqueByGeometry = (matches: readonly IRNode[], target: IRNode, label: string,
    ambiguousIsMissing = false): IRNode | undefined => {
    if (matches.length <= 1) return matches[0];
    const targetRect = rawRect(target);
    if (!targetRect) throw new Error(`${label} has ${matches.length} matches without target geometry`);
    const ranked = matches.map((node) => {
        const rect = rawRect(node);
        const distance = rect ? ['x', 'y', 'width', 'height'].reduce((sum, key) =>
            sum + Math.abs(Number(rect[key]) - Number(targetRect[key])), 0) : Number.POSITIVE_INFINITY;
        return { node, distance };
    }).sort((a, b) => a.distance - b.distance);
    if (!Number.isFinite(ranked[0]!.distance) || ranked[0]!.distance === ranked[1]!.distance) {
        if (ambiguousIsMissing) return undefined;
        throw new Error(`${label} remains ambiguous after geometry matching`);
    }
    return ranked[0]!.node;
};
const clearSameKeyWrapper = (node: IRNode, key: string): void => {
    if (node.responsive?.applicationStateKey === key) {
        delete node.responsive.applicationStateKey;
        delete node.responsive.visibilityByApplicationState;
        delete node.responsive.applicationStateWhen;
    }
    node.children.forEach((child) => clearSameKeyWrapper(child, key));
};
const structuralResponsive = (node: IRNode): boolean =>
    (node.responsive?.visibility ?? []).some((variant) => variant.structural === true);
const generatedTransientOverlay = (node: IRNode): boolean =>
    /-id-_r_[^/:]*:\d+\/div-(?:presentation-unnamed|data-slot-(?:tooltip|popover|menu))/.test(
        node.source_node_id ?? '');
const terminalAxis = (responsive: any, axis: 'horizontal' | 'vertical'): any => {
    const variants = responsive?.[`${axis}Variants`];
    return variants?.length ? variants.at(-1).constraint : responsive?.[axis];
};
const axisDimension = (axis: any): string | undefined => {
    if (!axis) return undefined;
    if (axis.kind === 'fixed' && Number.isFinite(axis.value)) return `${axis.value}px`;
    if ((axis.kind === 'fill' || axis.kind === 'proportional') &&
        Number.isFinite(axis.offset ?? 0)) {
        const percent = axis.kind === 'fill' ? 100 : Number(axis.ratio ?? 1) * 100;
        const offset = Number(axis.offset ?? 0);
        if (offset === 0) return `${percent}%`;
        return `calc(${percent}% ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}px)`;
    }
    return undefined;
};
const relativeAxisDimension = (axis: any): string | undefined =>
    axis?.kind === 'fill' || axis?.kind === 'proportional' ? axisDimension(axis) : undefined;
const axisAtViewport = (responsive: any, axis: 'horizontal' | 'vertical', viewport: number): any => {
    const variants = responsive?.[`${axis}Variants`];
    if (!variants?.length) return responsive?.[axis];
    let selected = variants[0]?.constraint;
    for (let index = 0; index + 1 < variants.length; index++)
        if (variants[index]?.transitionToNext?.upperBound <= viewport)
            selected = variants[index + 1]?.constraint;
    return selected;
};
const horizontalExtent = (axis: any, viewport: number): number | undefined => {
    if (!axis) return undefined;
    if (axis.kind === 'fixed') return Number(axis.value);
    if (axis.kind === 'fill') return viewport + Number(axis.offset ?? 0);
    if (axis.kind === 'proportional')
        return viewport * Number(axis.ratio ?? 1) + Number(axis.offset ?? 0);
    if (axis.kind === 'min')
        return Math.max(Number(axis.min ?? 0), viewport * Number(axis.ratio ?? 1) + Number(axis.offset ?? 0));
    return undefined;
};
export function composeResponsiveApplicationStateLayers(
    base: IRNode,
    dimensions: readonly ResponsiveApplicationStateLayerDimension[],
): { root: IRNode; report: ResponsiveApplicationStateLayerReport } {
    const root = clone(base);
    const assigned = new WeakMap<IRNode, { fingerprint: string; label: string }>();
    let projectedResponsiveRecords = 0, insertedStructuralNodes = 0,
        insertedStateResponsiveBranches = 0, projectedStateResponsivePatches = 0,
        projectedIntrinsicSizingRecords = 0,
        preservedUnmatchedStateFrontiers = 0, preservedGeneratedTransientOverlays = 0,
        repairedOverflowingBaselineAxes = 0;
    const preservedTransientNodes = new WeakSet<IRNode>();
    const assignedIntrinsicSizing = new WeakMap<IRNode, { fingerprint: string; label: string }>();
    const matchedFrontiers: Record<string, number> = {};
    const matchedAbsentFrontiers: Record<string, number> = {};
    const projectedResponsiveRecordsByLayer: Record<string, number> = {};
    const projectedStateResponsivePatchesByLayer: Record<string, number> = {};
    const applyResponsive = (target: IRNode, source: IRNode, label: string) => {
        // Framework-generated portals have unstable source ids and can be
        // incidentally open because a capture action hovered a control. They
        // require their own explicit overlay-state cohort; never infer their
        // viewport behavior from an unrelated application-state dimension.
        if (generatedTransientOverlay(target)) {
            if (!preservedTransientNodes.has(target)) {
                preservedTransientNodes.add(target);
                preservedGeneratedTransientOverlays++;
            }
            return;
        }
        const payload = viewportResponsive(source.responsive);
        if (!payload) return;
        const fingerprint = stable(payload), prior = assigned.get(target);
        if (prior !== undefined && prior.fingerprint !== fingerprint)
            throw new Error(`responsive layers conflict on ${protectedApplicationStateStableIdentity(target)} (${prior.label} vs ${label})`);
        const preserved = target.responsive ? clone(target.responsive) : undefined;
        target.responsive = { ...(preserved ?? { visibility: [], layoutVariants: [], sampledViewports: [] }),
            ...payload };
        assigned.set(target, { fingerprint, label }); projectedResponsiveRecords++;
        projectedResponsiveRecordsByLayer[label] = (projectedResponsiveRecordsByLayer[label] ?? 0) + 1;
    };
    const applyIntrinsicSizing = (target: IRNode, source: IRNode, label: string) => {
        const sourceLayout = source.layout as any;
        const payload = Object.fromEntries(['widthMode', 'heightMode']
            .filter((field) => sourceLayout?.[field] === 'hug')
            .map((field) => [field, 'hug']));
        if (!Object.keys(payload).length) return;
        const fingerprint = stable(payload), prior = assignedIntrinsicSizing.get(target);
        if (prior !== undefined && prior.fingerprint !== fingerprint)
            throw new Error(`responsive layers conflict on intrinsic sizing for ${protectedApplicationStateStableIdentity(target)} (${prior.label} vs ${label})`);
        const targetLayout = (target.layout ??= {}) as any;
        for (const [field, value] of Object.entries(payload)) {
            targetLayout[field] = value;
            delete targetLayout[field === 'widthMode' ? 'width' : 'height'];
            // A responsive layer's hug sizing is authored/inferred sizing
            // semantics, whereas the canonical native document may still
            // contain a browser-used pixel dimension in its materialized
            // style payload. Keeping that stale value makes the fixed pixel
            // dimension win over hug layout. Clear only the corresponding
            // dimension; measured intrinsic reflow floors remain attached in
            // the projected responsive record.
            const targetStyle = (target as any).style;
            if (targetStyle)
                delete targetStyle[field === 'widthMode' ? 'width' : 'height'];
        }
        assignedIntrinsicSizing.set(target, { fingerprint, label });
        projectedIntrinsicSizingRecords++;
    };
    for (const dimension of dimensions) {
        const values = Object.entries(dimension.values);
        if (values.length < 2) throw new Error(`responsive dimension ${dimension.key} requires at least two values`);
        const layerIndices = new Map(values.map(([value, layer]) => [value, {
            stable: indexTree(layer), source: indexSourceIds(layer), semantic: indexSemantic(layer),
            shape: indexShapePaths(layer), local: indexLocalSemantic(layer),
        }]));
        const sourceFor = (node: IRNode, value: string, ambiguousIsMissing = false,
            allowLocalSemantic = true, allowShape = true): IRNode | undefined => {
            const index = layerIndices.get(value)!;
            const exact = node.source_node_id ? index.source.get(node.source_node_id) ?? [] : [];
            if (exact.length === 1) return exact[0];
            const stableMatches = index.stable.get(protectedApplicationStateStableIdentity(node)) ?? [];
            if (stableMatches.length === 1) return stableMatches[0];
            if (!allowShape) return undefined;
            const semanticMatches = index.semantic.get(protectedApplicationStateSemanticIdentity(node)) ?? [];
            if (semanticMatches.length === 1) return semanticMatches[0];
            const shapeMatch = uniqueByGeometry(index.shape.get(shapePathIdentity(node)) ?? [], node,
                `${dimension.key}:${value}:shape:${protectedApplicationStateStableIdentity(node)}`,
                ambiguousIsMissing);
            if (shapeMatch || !allowLocalSemantic) return shapeMatch;
            return uniqueByGeometry(
                index.local.get(protectedApplicationStateLocalSemanticIdentity(node)) ?? [], node,
                `${dimension.key}:${value}:local-semantic:${protectedApplicationStateStableIdentity(node)}`,
                ambiguousIsMissing);
        };
        const commonPayload = new Map<string, { source: IRNode; fingerprint: string }>();
        const identities = new Set(values.flatMap(([, layer]) => [...indexTree(layer).keys()]));
        for (const identity of identities) {
            const nodes = values.map(([value]) => {
                const matches = layerIndices.get(value)!.stable.get(identity) ?? [];
                return matches.length === 1 ? matches[0] : undefined;
            });
            if (nodes.some((node) => !node)) continue;
            const payloads = nodes.map((node) => viewportResponsive(node!.responsive));
            if (payloads.some((payload) => !payload)) continue;
            const fingerprints = payloads.map(stable);
            if (new Set(fingerprints).size === 1)
                commonPayload.set(identity, { source: nodes[0]!, fingerprint: fingerprints[0]! });
        }
        const reconcile = (target: IRNode, source: IRNode, value: string,
            allowStructuralInsert = true) => {
            if (target.responsive?.applicationStateKey &&
                target.responsive.applicationStateKey !== dimension.key)
                return;
            applyResponsive(target, source, `${dimension.key}:${value}`);
            applyIntrinsicSizing(target, source, `${dimension.key}:${value}`);
            const targetByIdentity = new Map<string, IRNode[]>();
            for (const child of target.children) {
                const identity = protectedApplicationStateStableIdentity(child);
                targetByIdentity.set(identity, [...(targetByIdentity.get(identity) ?? []), child]);
            }
            const sourceByIdentity = new Map<string, IRNode[]>();
            for (const child of source.children) {
                const identity = protectedApplicationStateStableIdentity(child);
                sourceByIdentity.set(identity, [...(sourceByIdentity.get(identity) ?? []), child]);
            }
            const matchedSources = new Set<IRNode>();
            for (const [identity, targetChildren] of targetByIdentity) {
                const sourceChildren = sourceByIdentity.get(identity) ?? [];
                for (const targetChild of targetChildren) {
                    const remaining = sourceChildren.filter((child) => !matchedSources.has(child));
                    const exact = targetChild.source_node_id
                        ? remaining.filter((child) => child.source_node_id === targetChild.source_node_id) : [];
                    const sourceChild = exact.length === 1 ? exact[0]
                        : uniqueByGeometry(remaining, targetChild,
                            `${dimension.key}:${value}:sibling:${identity}`);
                    if (!sourceChild) continue;
                    matchedSources.add(sourceChild);
                    reconcile(targetChild, sourceChild, value, allowStructuralInsert);
                }
            }
            for (const [identity, sourceChildren] of sourceByIdentity) for (const sourceChild of sourceChildren) {
                if (matchedSources.has(sourceChild) || targetByIdentity.has(identity) ||
                    !allowStructuralInsert || !structuralResponsive(sourceChild)) continue;
                const candidate = clone(sourceChild);
                clearSameKeyWrapper(candidate, dimension.key);
                const sourceIndex = source.children.indexOf(sourceChild);
                const nextIdentity = source.children.slice(sourceIndex + 1)
                    .map(protectedApplicationStateStableIdentity).find((item) => targetByIdentity.has(item));
                const priorIdentity = source.children.slice(0, sourceIndex).reverse()
                    .map(protectedApplicationStateStableIdentity).find((item) => targetByIdentity.has(item));
                if (nextIdentity) target.children.splice(target.children.indexOf(targetByIdentity.get(nextIdentity)![0]!), 0, candidate);
                else if (priorIdentity) {
                    const siblings = targetByIdentity.get(priorIdentity)!;
                    target.children.splice(target.children.indexOf(siblings.at(-1)!) + 1, 0, candidate);
                }
                else if (target.children.length === 0) target.children.push(candidate);
                else throw new Error(`${dimension.key}:${value} cannot anchor structural child ${identity}`);
                targetByIdentity.set(identity, [...(targetByIdentity.get(identity) ?? []), candidate]);
                insertedStructuralNodes++;
                reconcile(candidate, sourceChild, value, allowStructuralInsert);
            }
        };
        const visit = (node: IRNode, parent?: IRNode, insideForeignFrontier = false,
            context = new Map<string, string>()) => {
            const responsive = node.responsive;
            const nextContext = new Map(context);
            for (const predicate of responsive?.applicationStateWhen ?? [])
                nextContext.set(predicate.key, predicate.value);
            if (responsive?.applicationStateKey) {
                const visible = Object.entries(responsive.visibilityByApplicationState ?? {})
                    .filter(([, selected]) => selected).map(([value]) => value);
                if (visible.length === 1) nextContext.set(responsive.applicationStateKey, visible[0]!);
            }
            const visibleValue = responsive?.applicationStateKey === dimension.key
                ? Object.entries(responsive.visibilityByApplicationState ?? {})
                    .find(([, visible]) => visible)?.[0] : undefined;
            const scoped = responsive?.applicationStateKey === dimension.key &&
                sameScope(stateScope(node), dimension.whenByValue?.[visibleValue ?? ''] ?? dimension.when ?? []);
            if (visibleValue && scoped) {
                if (!layerIndices.has(visibleValue))
                    throw new Error(`${dimension.key} has no responsive layer for ${visibleValue}`);
                const source = sourceFor(node, visibleValue);
                if (!source) {
                    // A protected base can contain an orthogonal-state branch
                    // absent from this responsive cohort (for example a
                    // non-default display mode). Preserve its already-proven
                    // responsive payload; never substitute a different
                    // cohort's similarly shaped node.
                    if (viewportResponsive(node.responsive)) {
                        preservedUnmatchedStateFrontiers++;
                        return;
                    }
                    throw new Error(`${dimension.key}:${visibleValue} frontier has no source match for ${protectedApplicationStateStableIdentity(node)}`);
                }
                matchedFrontiers[`${dimension.key}:${visibleValue}`] =
                    (matchedFrontiers[`${dimension.key}:${visibleValue}`] ?? 0) + 1;
                reconcile(node, source, visibleValue);
                return;
            }
            const foreignFrontier = !!responsive?.applicationStateKey &&
                responsive.applicationStateKey !== dimension.key;
            const foreignContext = insideForeignFrontier || foreignFrontier;
            const allValueScopesMatch = values.every(([value]) =>
                (dimension.whenByValue?.[value] ?? dimension.when ?? []).every((predicate) =>
                    nextContext.get(predicate.key) === predicate.value));
            const projectionAllowed = !foreignFrontier && (!foreignContext || allValueScopesMatch);
            const scopes = values.map(([value]) =>
                dimension.whenByValue?.[value] ?? dimension.when ?? []);
            const sharedProjectionIsScoped = scopes[0]!.length > 0 &&
                scopes.every((scope) => sameScope(scope, scopes[0]!));
            // A property-owned state dimension has no duplicated
            // `applicationStateKey` branch. When every layer carries the same
            // route scope, projection is still safe inside a context that
            // proves that scope; refusing it would require a fake portal owner
            // solely to attach responsive patches.
            if (projectionAllowed && (!sharedProjectionIsScoped || allValueScopesMatch) && parent) {
                const stateSources = values.map(([value]) => ({ value,
                    source: sourceFor(node, value, true, false, false) }));
                if (stateSources.every(({ source }) => viewportResponsive(source?.responsive))) {
                    const fingerprints = stateSources.map(({ source }) => stable(viewportResponsive(source!.responsive)));
                    if (new Set(fingerprints).size > 1) {
                        const targetRect = rawRect(node);
                        const ranked = stateSources.map((item) => {
                            const rect = rawRect(item.source!);
                            const distance = targetRect && rect
                                ? ['x', 'y', 'width', 'height'].reduce((sum, key) =>
                                    sum + Math.abs(Number(rect[key]) - Number(targetRect[key])), 0)
                                : Number.POSITIVE_INFINITY;
                            return { ...item, distance };
                        }).sort((a, b) => a.distance - b.distance);
                        const baseline = ranked[0]!;
                        if (Number.isFinite(baseline.distance)) {
                            const baselineSource = clone(baseline.source!);
                            const sampled = baselineSource.responsive?.sampledViewports ?? [];
                            for (const viewport of sampled) {
                                const baselineAxis = axisAtViewport(baselineSource.responsive, 'horizontal', viewport);
                                const baselineExtent = horizontalExtent(baselineAxis, viewport);
                                if (baselineExtent === undefined || baselineExtent <= viewport + 0.5) continue;
                                const alternate = ranked.slice(1).map((item) => ({ item,
                                    axis: axisAtViewport(item.source!.responsive, 'horizontal', viewport) }))
                                    .map((candidate) => ({ ...candidate,
                                        extent: horizontalExtent(candidate.axis, viewport) }))
                                    .find((candidate) => candidate.extent !== undefined && candidate.extent <= viewport + 0.5);
                                if (!alternate) continue;
                                const responsive = baselineSource.responsive ??= {
                                    visibility: [], layoutVariants: [], sampledViewports: [],
                                };
                                const variants = responsive.horizontalVariants;
                                if (variants?.length) {
                                    let selected = 0;
                                    for (let index = 0; index + 1 < variants.length; index++) {
                                        const bound = variants[index]?.transitionToNext?.upperBound;
                                        if (bound !== undefined && bound <= viewport) selected = index + 1;
                                    }
                                    variants[selected]!.constraint = clone(alternate.axis);
                                } else responsive.horizontal = clone(alternate.axis);
                                repairedOverflowingBaselineAxes++;
                            }
                            applyResponsive(node, baselineSource, `${dimension.key}:${baseline.value}`);
                            node.responsive ??= { visibility: [], layoutVariants: [], sampledViewports: [] };
                            node.responsive.applicationStateVariants ??= [];
                            const supported = new Set(['marginTop', 'marginRight', 'marginBottom', 'marginLeft',
                                'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap', 'rowGap',
                                'columnGap', 'top', 'right', 'bottom', 'left']);
                            const baselineWidth = relativeAxisDimension(
                                terminalAxis(baseline.source!.responsive, 'horizontal'));
                            const baselineHeight = relativeAxisDimension(
                                terminalAxis(baseline.source!.responsive, 'vertical'));
                            const baselineLiterals = baseline.source!.responsive?.layoutVariants?.at(-1)
                                ?.computedStyleLiterals ?? {};
                            for (const item of stateSources) {
                                if (item.value === baseline.value) continue;
                                const layout: Record<string, string> = {};
                                const width = relativeAxisDimension(
                                    terminalAxis(item.source!.responsive, 'horizontal'));
                                const height = relativeAxisDimension(
                                    terminalAxis(item.source!.responsive, 'vertical'));
                                if (width && width !== baselineWidth) layout.width = width;
                                if (height && height !== baselineHeight) layout.height = height;
                                const literals = item.source!.responsive?.layoutVariants?.at(-1)
                                    ?.computedStyleLiterals ?? {};
                                for (const [field, value] of Object.entries(literals)) {
                                    if (!supported.has(field) || baselineLiterals[field] === value) continue;
                                    const baselineAuthored = authoredRelativeLayoutValue(baseline.source!, field);
                                    const itemAuthored = authoredRelativeLayoutValue(item.source!, field);
                                    // Computed margins/paddings are used pixels in the
                                    // capture's containing block. When authored CSS
                                    // still owns that field, retain its relative
                                    // contract instead of promoting a sampled pixel
                                    // into an application-wide state override.
                                    if (itemAuthored !== undefined) {
                                        if (itemAuthored === baselineAuthored) continue;
                                        layout[field] = itemAuthored;
                                    } else layout[field] = String(value);
                                }
                                if (!Object.keys(layout).length) continue;
                                const patch = { key: dimension.key, value: item.value,
                                    when: [...(dimension.whenByValue?.[item.value] ?? dimension.when ?? [])],
                                    layout };
                                const prior = node.responsive.applicationStateVariants.find((variant: any) =>
                                    variant.key === patch.key && variant.value === patch.value);
                                if (prior) {
                                    const priorWhen = prior.when ?? [], nextWhen = patch.when ?? [];
                                    if (priorWhen.length && nextWhen.length && !sameScope(priorWhen, nextWhen))
                                        throw new Error(`${dimension.key}:${item.value} has conflicting state-responsive scopes on ${protectedApplicationStateStableIdentity(node)}`);
                                    prior.when = priorWhen.length ? priorWhen : nextWhen;
                                    prior.layout ??= {};
                                    for (const [field, value] of Object.entries(patch.layout)) {
                                        // The state cohort supplies a literal at
                                        // its capture viewport; the responsive
                                        // cohort may prove that value is really
                                        // proportional/fill. This composer is
                                        // the reviewed responsive-over-state
                                        // precedence boundary, so replace the
                                        // same key/value field with the proven
                                        // constraint (scope conflicts still
                                        // fail above).
                                        prior.layout[field] = value;
                                    }
                                } else node.responsive.applicationStateVariants.push(patch);
                                projectedStateResponsivePatches++;
                                const patchLabel = `${dimension.key}:${item.value}`;
                                projectedStateResponsivePatchesByLayer[patchLabel] =
                                    (projectedStateResponsivePatchesByLayer[patchLabel] ?? 0) + 1;
                            }
                            for (const [value] of values)
                                matchedFrontiers[`${dimension.key}:${value}`] =
                                    (matchedFrontiers[`${dimension.key}:${value}`] ?? 0) + 1;
                        }
                    }
                }
            }
            if (projectionAllowed && !sharedProjectionIsScoped) {
                const common = commonPayload.get(protectedApplicationStateStableIdentity(node));
                if (common) {
                    applyResponsive(node, common.source, `${dimension.key}:common`);
                    applyIntrinsicSizing(node, common.source, `${dimension.key}:common`);
                }
            }
            // Orthogonal dimensions must continue through a foreign owner's
            // branch so nested state (for example a review panel inside each
            // sidebar branch) is composed independently. Only the foreign
            // owner node itself is protected from common-payload projection.
            [...node.children].forEach((child) => visit(child, node, foreignContext, nextContext));
        };
        visit(root);
        const scopedOwners: IRNode[] = [];
        const collectScopedOwners = (node: IRNode) => {
            if (node.responsive?.applicationStateKey === dimension.key) {
                const visible = Object.entries(node.responsive.visibilityByApplicationState ?? {})
                    .filter(([, selected]) => selected).map(([value]) => value);
                if (visible.length === 1 && sameScope(stateScope(node),
                    dimension.whenByValue?.[visible[0]!] ?? dimension.when ?? []))
                    scopedOwners.push(node);
            }
            node.children.forEach(collectScopedOwners);
        };
        collectScopedOwners(root);
        for (const [value] of values) {
            if (matchedFrontiers[`${dimension.key}:${value}`]) continue;
            const claimed = scopedOwners.some((owner) =>
                owner.responsive?.visibilityByApplicationState?.[value] === true);
            const provenAbsent = scopedOwners.length > 0 && !claimed &&
                // Absence is structural evidence. Fuzzy geometry/local-semantic
                // matching can pair an unrelated generic frame with the owner,
                // so only exact/stable authored identity may disprove it.
                scopedOwners.every((owner) =>
                    sourceFor(owner, value, true, false, false) === undefined);
            if (provenAbsent) {
                matchedAbsentFrontiers[`${dimension.key}:${value}`] = scopedOwners.length;
                continue;
            }
            throw new Error(`${dimension.key}:${value} has no matching existing owner/value frontier`);
        }
    }
    return { root, report: { dimensions: dimensions.map(({ key }) => key),
        projectedResponsiveRecords, projectedResponsiveRecordsByLayer, insertedStructuralNodes,
        projectedStateResponsivePatchesByLayer,
        insertedStateResponsiveBranches, projectedStateResponsivePatches,
        projectedIntrinsicSizingRecords,
        preservedGeneratedTransientOverlays, repairedOverflowingBaselineAxes,
        preservedUnmatchedStateFrontiers, matchedFrontiers, matchedAbsentFrontiers } };
}
