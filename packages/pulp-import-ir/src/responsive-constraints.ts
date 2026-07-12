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
export interface ResponsiveAxisVariant { constraint: ResponsiveAxisConstraint; transitionToNext?: ResponsiveBreakpointInterval }
export interface ResponsiveBreakpointInterval { lowerBound: number; upperBound: number; confidence: 'bounded' | 'measured' | 'authored'; axis?: 'width' | 'height' }
export interface ResponsiveVisibilityVariant { visible: boolean; structural: boolean; transitionToNext?: ResponsiveBreakpointInterval }
export interface ResponsiveLayoutVariant {
    flexDirection?: string;
    flexWrap?: string;
    childOrder?: string[];
    computedStyleLiterals?: Record<string, string>;
    reflowed: boolean;
    transitionToNext?: ResponsiveBreakpointInterval;
}
export interface TypedResponsiveConstraints {
    horizontal?: ResponsiveAxisConstraint;
    vertical?: ResponsiveAxisConstraint;
    horizontalVariants?: ResponsiveAxisVariant[];
    verticalVariants?: ResponsiveAxisVariant[];
    visibility: ResponsiveVisibilityVariant[];
    layoutVariants: ResponsiveLayoutVariant[];
    applicationStateKey?: string;
    visibilityByApplicationState?: Record<string, boolean>;
    sampledViewports: number[];
}
export interface ResponsiveDiagnostic { sourceId: string; code: 'ambiguous-axis' | 'ambiguous-2d-variant' | 'non-monotonic-visibility' | 'bounded-breakpoint'; message: string }
export interface ResponsiveMatchReport { matched: number; structuralVariants: number; unmatched: number; ambiguous: number }
export interface ResponsiveReconciliation { constraints: Map<string, TypedResponsiveConstraints>; diagnostics: ResponsiveDiagnostic[]; matchReport: ResponsiveMatchReport }
export interface StableIdentityAlignmentReport {
    aligned: number;
    canonicalPreserved: number;
    collisions: number;
    refusedCollisions: number;
    collisionCategories: Record<string, number>;
}
export interface StableIdentityAlignment { captures: ResponsiveCapture[]; report: StableIdentityAlignmentReport }

interface Sample { captureIndex: number; viewport: number; viewportHeight: number; node: ObservedDomNode; parent?: ObservedDomNode }

export function alignStableObservedDomIdentitiesWithReport(captures: readonly ResponsiveCapture[]): StableIdentityAlignment {
    if (!captures.length) return { captures: [], report: {
        aligned: 0, canonicalPreserved: 0, collisions: 0, refusedCollisions: 0, collisionCategories: {},
    } };
    const volatileId = (id: string | undefined) => !!id && /(?:base-ui|radix)-_?r_/i.test(id);
    const stable = (node: ObservedDomNode) => {
        const attributes = node.attributes ?? {};
        const testId = attributes['data-testid']; if (testId) return `test:${testId}`;
        const slot = attributes['data-slot']; if (slot) return `slot:${slot}`;
        const id = attributes.id;
        // React/Base UI use per-render ids such as base-ui-_r_c_. Treat those as
        // transport state, not authored identity.
        return id && !volatileId(id) ? `id:${id}` : undefined;
    };
    const canonical = (id: string) => id.startsWith('dom/');
    const indexStable = (root: ObservedDomNode) => {
        const out = new Map<string, string[]>();
        const walk = (node: ObservedDomNode, stableParent = '') => {
            const marker = stable(node);
            let parent = stableParent;
            if (marker) {
                const signature = `${stableParent}/${node.tagName}[${marker}]`;
                const ids = out.get(signature) ?? [];
                ids.push(node.sourceId);
                out.set(signature, ids);
                // Repeated markers are not durable ancestors unless the
                // capture itself supplied canonical IDs. Keep descendants in
                // a collision bucket rather than inventing ordinal identity.
                parent = signature;
            }
            node.children.forEach((child) => walk(child, parent));
        };
        walk(root); return out;
    };
    const normalizeVolatileIds = (source: ObservedDomNode) => {
        const root = structuredClone(source);
        const replacements: Array<readonly [string, string]> = [];
        const collect = (node: ObservedDomNode) => {
            const id = node.attributes?.id;
            if (volatileId(id)) replacements.push([node.sourceId, node.sourceId.replace(`[${id}]`, '')]);
            node.children.forEach(collect);
        };
        collect(root);
        replacements.sort((a, b) => b[0].length - a[0].length);
        const rewrite = (id: string) => {
            const prefix = replacements.find(([old]) => id === old || id.startsWith(`${old}/`));
            return prefix ? `${prefix[1]}${id.slice(prefix[0].length)}` : id;
        };
        const walk = (node: ObservedDomNode) => {
            node.sourceId = rewrite(node.sourceId);
            for (const item of node.content ?? []) if (item.kind === 'child') item.sourceId = rewrite(item.sourceId);
            node.children.forEach(walk);
        };
        walk(root); return root;
    };
    const normalized = captures.map((capture) => ({ viewport: { ...capture.viewport }, root: normalizeVolatileIds(capture.root) }));
    const reference = indexStable(normalized.at(-1)!.root);
    let aligned = 0, canonicalPreserved = 0, collisions = 0, refusedCollisions = 0;
    const collisionCategories: Record<string, number> = {};
    const alignedCaptures = normalized.map((capture) => {
        const root = structuredClone(capture.root);
        const current = indexStable(root);
        const prefixes: Array<readonly [string, string]> = [];
        for (const [key, oldIds] of current) {
            const referenceIds = reference.get(key);
            if (!referenceIds) continue;
            if (oldIds.length !== 1 || referenceIds.length !== 1) {
                const amount = Math.max(oldIds.length, referenceIds.length);
                collisions += amount;
                refusedCollisions += amount;
                const category = key.includes('[slot:') ? 'data-slot'
                    : key.includes('[test:') ? 'data-testid' : key.includes('[id:') ? 'id' : 'other';
                collisionCategories[category] = (collisionCategories[category] ?? 0) + amount;
                continue;
            }
            const oldId = oldIds[0], referenceId = referenceIds[0];
            if (oldId === referenceId && canonical(oldId)) { canonicalPreserved++; continue; }
            // Canonical capture IDs are already the source-of-truth. Never
            // rewrite one canonical node to another merely because their slot
            // markers happen to collide.
            if (canonical(oldId) || canonical(referenceId)) continue;
            prefixes.push([oldId, referenceId]);
            if (oldId !== referenceId) aligned++;
        }
        prefixes.sort((a, b) => b[0].length - a[0].length);
        const rewrite = (id: string) => {
            const prefix = prefixes.find(([old]) => id === old || id.startsWith(`${old}/`));
            return prefix ? `${prefix[1]}${id.slice(prefix[0].length)}` : id;
        };
        const walk = (node: ObservedDomNode) => {
            node.sourceId = rewrite(node.sourceId);
            for (const item of node.content ?? []) if (item.kind === 'child') item.sourceId = rewrite(item.sourceId);
            node.children.forEach(walk);
        };
        walk(root);
        const repairParentPaths = (parent: ObservedDomNode) => {
            for (const child of parent.children) {
                if (!child.sourceId.startsWith(`${parent.sourceId}/`)) {
                    const old = child.sourceId;
                    const replacement = `${parent.sourceId}/${old.slice(old.lastIndexOf('/') + 1)}`;
                    const rewriteBranch = (node: ObservedDomNode) => {
                        if (node.sourceId === old || node.sourceId.startsWith(`${old}/`))
                            node.sourceId = `${replacement}${node.sourceId.slice(old.length)}`;
                        for (const item of node.content ?? []) if (item.kind === 'child' &&
                            (item.sourceId === old || item.sourceId.startsWith(`${old}/`)))
                            item.sourceId = `${replacement}${item.sourceId.slice(old.length)}`;
                        node.children.forEach(rewriteBranch);
                    };
                    rewriteBranch(child);
                    for (const item of parent.content ?? []) if (item.kind === 'child' && item.sourceId === old)
                        item.sourceId = replacement;
                }
                repairParentPaths(child);
            }
        };
        repairParentPaths(root);
        return { viewport: { ...capture.viewport }, root };
    });
    return { captures: alignedCaptures, report: {
        aligned, canonicalPreserved, collisions, refusedCollisions, collisionCategories,
    } };
}

export function alignStableObservedDomIdentities(captures: readonly ResponsiveCapture[]): ResponsiveCapture[] {
    return alignStableObservedDomIdentitiesWithReport(captures).captures;
}
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
    const container = samples.map(({ parent, viewport, viewportHeight }) => parent
        ? (axis === 'horizontal' ? parent.rect.width : parent.rect.height)
        : (axis === 'horizontal' ? viewport : viewportHeight));
    const fixed = { kind: 'fixed' as const, value: mean(size), residual: rms(size, size.map(() => mean(size))) };
    const fit = linear(container, size);
    const range = Math.max(...size) - Math.min(...size);
    const boundProperties = axis === 'horizontal' ? ['minWidth', 'maxWidth'] as const : ['minHeight', 'maxHeight'] as const;
    const parsedBound = (name: string) => {
        const values = samples.map(({ node }) => Number.parseFloat(node.computedStyle[name] ?? ''));
        return values.every(Number.isFinite) && Math.max(...values) - Math.min(...values) <= 0.5
            ? mean(values) : undefined;
    };
    const authoredMin = parsedBound(boundProperties[0]), authoredMax = parsedBound(boundProperties[1]);
    const boundedCandidate = (kind: 'min' | 'max', bound: number | undefined) => {
        if (bound === undefined) return undefined;
        const free = samples.map((_, index) => index).filter((index) => kind === 'max'
            ? size[index] < bound - 0.5 : size[index] > bound + 0.5);
        if (free.length < 2) return undefined;
        const freeFit = linear(free.map((index) => container[index]), free.map((index) => size[index]));
        if (freeFit.ratio <= 0.02 || freeFit.residual > 1) return undefined;
        const predicted = container.map((value) => kind === 'max'
            ? Math.min(freeFit.ratio * value + freeFit.offset, bound)
            : Math.max(freeFit.ratio * value + freeFit.offset, bound));
        const residual = rms(size, predicted);
        return residual <= 1 ? {
            kind, [kind]: rounded(bound), ratio: rounded(freeFit.ratio),
            offset: rounded(freeFit.offset), residual: rounded(residual),
        } as ResponsiveAxisConstraint : undefined;
    };
    const authoredClamp = boundedCandidate('max', authoredMax) ?? boundedCandidate('min', authoredMin);
    if (authoredClamp) return authoredClamp;
    // Breakpoint triplets can leave only W and W+1 in the terminal segment.
    // A genuinely fluid child then has a 0.5 px fixed residual, but an exact
    // fill model. Preserve the observed slope whenever the size actually
    // changes; otherwise imports freeze at the widest capture and crop when
    // the native window grows beyond it.
    if (Math.abs(fit.ratio - 1) <= 0.03 && fit.residual <= 1)
        return { kind: 'fill', offset: rounded(fit.offset), residual: rounded(fit.residual) };
    if (fixed.residual <= 0.5) return { ...fixed, value: rounded(fixed.value), residual: rounded(fixed.residual) };
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

function variantAxis<T extends { viewport: number; viewportHeight: number }>(
    records: readonly T[], key: (record: T) => string,
): { axis: 'width' | 'height'; ordered: T[] } {
    const keySets = (axis: 'width' | 'height') => {
        const groups = new Map<number, Set<string>>();
        for (const record of records) {
            const coordinate = axis === 'width' ? record.viewport : record.viewportHeight;
            const values = groups.get(coordinate) ?? new Set<string>();
            values.add(key(record)); groups.set(coordinate, values);
        }
        return groups;
    };
    const widthGroups = keySets('width');
    const axis = [...widthGroups.values()].some((values) => values.size > 1) ? 'height' : 'width';
    const groups = keySets(axis);
    if ([...groups.values()].some((values) => values.size > 1))
        throw new Error(`responsive ${axis} slices contain conflicting 2D states`);
    const unique = new Map<number, T>();
    for (const record of records) {
        const coordinate = axis === 'width' ? record.viewport : record.viewportHeight;
        if (!unique.has(coordinate)) unique.set(coordinate, record);
    }
    return { axis, ordered: [...unique].sort(([a], [b]) => a - b).map(([, record]) => record) };
}

function visibility(records: Array<{ viewport: number; viewportHeight: number; present: boolean; visible: boolean }>): ResponsiveVisibilityVariant[] {
    const selected = variantAxis(records, (record) => `${record.present}|${record.visible}`);
    const ordered = selected.ordered;
    const variants: ResponsiveVisibilityVariant[] = [];
    let start = 0;
    for (let i = 1; i <= ordered.length; i++) if (i === ordered.length || ordered[i].visible !== ordered[start].visible || ordered[i].present !== ordered[start].present) {
        variants.push({ visible: ordered[start].visible, structural: ordered.slice(start, i).some((sample) => !sample.present) });
        if (i < ordered.length) variants.at(-1)!.transitionToNext = {
            lowerBound: selected.axis === 'width' ? ordered[i - 1].viewport : ordered[i - 1].viewportHeight,
            upperBound: selected.axis === 'width' ? ordered[i].viewport : ordered[i].viewportHeight,
            confidence: Math.abs((selected.axis === 'width' ? ordered[i].viewport : ordered[i].viewportHeight) -
                (selected.axis === 'width' ? ordered[i - 1].viewport : ordered[i - 1].viewportHeight)) <= 1 ? 'measured' : 'bounded',
            ...(selected.axis === 'height' ? { axis: 'height' as const } : {}),
        };
        start = i;
    }
    return variants;
}

function layoutVariants(samples: Sample[]): ResponsiveLayoutVariant[] {
    let ordered = [...samples].sort((a, b) => a.viewport - b.viewport || a.viewportHeight - b.viewportHeight);
    const isFlex = (sample: Sample) => ['flex', 'inline-flex'].includes(sample.node.computedStyle.display);
    const literalKeys = [
        'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'gap', 'rowGap', 'columnGap', 'top', 'right', 'bottom', 'left',
        'overflowX', 'overflowY',
    ] as const;
    const changingLiteralKeys = literalKeys.filter((property) =>
        new Set(ordered.map((sample) => sample.node.computedStyle[property] ?? '')).size > 1);
    const literals = (sample: Sample) => Object.fromEntries(changingLiteralKeys.flatMap((property) => {
        const value = sample.node.computedStyle[property];
        return value === undefined || value === '' ? [] : [[property, value]];
    }));
    const key = (sample: Sample) => `${isFlex(sample) ? sample.node.computedStyle.flexDirection ?? '' : ''}|${isFlex(sample) ? sample.node.computedStyle.flexWrap ?? '' : ''}|${reflowed(sample.node)}|${JSON.stringify(literals(sample))}|${sample.node.children.map((child) => child.sourceId).join('\u0000')}`;
    const selected = variantAxis(ordered, key);
    ordered = selected.ordered;
    const out: ResponsiveLayoutVariant[] = [];
    let start = 0;
    for (let i = 1; i <= ordered.length; i++) if (i === ordered.length || key(ordered[i]) !== key(ordered[start])) {
        out.push({
            ...(isFlex(ordered[start]) ? {
                flexDirection: ordered[start].node.computedStyle.flexDirection,
                flexWrap: ordered[start].node.computedStyle.flexWrap,
            } : {}),
            childOrder: ordered[start].node.children.map((child) => child.sourceId),
            ...(changingLiteralKeys.length ? { computedStyleLiterals: literals(ordered[start]) } : {}),
            reflowed: reflowed(ordered[start].node),
        });
        if (i < ordered.length) out.at(-1)!.transitionToNext = {
            lowerBound: ordered[i - 1].viewport, upperBound: ordered[i].viewport,
            ...(selected.axis === 'height' ? {
                lowerBound: ordered[i - 1].viewportHeight, upperBound: ordered[i].viewportHeight,
                axis: 'height' as const,
            } : {}),
            confidence: Math.abs((selected.axis === 'width' ? ordered[i].viewport : ordered[i].viewportHeight) -
                (selected.axis === 'width' ? ordered[i - 1].viewport : ordered[i - 1].viewportHeight)) <= 1 ? 'measured' : 'bounded',
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
    const ordered = [...captures].sort((a, b) =>
        a.viewport.width - b.viewport.width || a.viewport.height - b.viewport.height);
    if (new Set(ordered.map(({ viewport }) => `${viewport.width}x${viewport.height}`)).size !== ordered.length)
        throw new Error('responsive viewport dimensions must be unique');
    const flattened = ordered.map((capture) => flatten(capture.root));
    const ids = new Set(flattened.flatMap(({ nodes }) => [...nodes.keys()]));
    const canonicalSlice = (groupBy: 'width' | 'height', distinct: 'width' | 'height') => {
        const groups = new Map<number, number[]>();
        ordered.forEach((capture, index) => {
            const key = capture.viewport[groupBy], indices = groups.get(key) ?? [];
            indices.push(index); groups.set(key, indices);
        });
        const ranked = [...groups].sort(([aKey, a], [bKey, b]) => {
            const aDistinct = new Set(a.map((index) => ordered[index].viewport[distinct])).size;
            const bDistinct = new Set(b.map((index) => ordered[index].viewport[distinct])).size;
            return bDistinct - aDistinct || bKey - aKey;
        });
        const indices = ranked[0][1];
        return { indices, distinctCount: new Set(indices.map((index) => ordered[index].viewport[distinct])).size };
    };
    // A 2D capture matrix must not feed repeated x/y observations into a 1D
    // regression. Horizontal constraints use the height slice with the most
    // distinct widths; vertical constraints use the width slice with the most
    // distinct heights. Ties select the largest (canonical) dimension.
    const horizontalSlice = canonicalSlice('height', 'width');
    const verticalSlice = canonicalSlice('width', 'height');
    const horizontalIndices = horizontalSlice.indices;
    const verticalIndices = new Set(verticalSlice.distinctCount > 1
        ? verticalSlice.indices : ordered.map((_, index) => index));
    const globalExactBoundaries = new Set<number>();
    for (let position = 1; position < horizontalIndices.length; ++position) {
        const beforeIndex = horizontalIndices[position - 1], afterIndex = horizontalIndices[position];
        if (ordered[afterIndex].viewport.width - ordered[beforeIndex].viewport.width !== 1) continue;
        const changed = [...ids].some((id) => {
            const before = flattened[beforeIndex].nodes.get(id), after = flattened[afterIndex].nodes.get(id);
            if (!before || !after) return before !== after;
            return before.computedStyle.display !== after.computedStyle.display ||
                before.computedStyle.flexDirection !== after.computedStyle.flexDirection ||
                before.computedStyle.flexWrap !== after.computedStyle.flexWrap ||
                before.children.map((child) => child.sourceId).join('\u0000') !==
                    after.children.map((child) => child.sourceId).join('\u0000');
        });
        if (changed) globalExactBoundaries.add(ordered[afterIndex].viewport.width);
    }
    // A source-owned JS/CSS breakpoint can also change geometry without
    // changing DOM structure or computed display mode. A captured W-1/W/W+1
    // triplet proves the exact threshold when the first one-pixel delta is
    // discontinuous and the second resumes a stable slope.
    for (let position = 1; position + 1 < horizontalIndices.length; ++position) {
        const beforeIndex = horizontalIndices[position - 1], atIndex = horizontalIndices[position],
            afterIndex = horizontalIndices[position + 1];
        if (ordered[atIndex].viewport.width - ordered[beforeIndex].viewport.width !== 1 ||
            ordered[afterIndex].viewport.width - ordered[atIndex].viewport.width !== 1) continue;
        if (globalExactBoundaries.has(ordered[afterIndex].viewport.width) &&
            !globalExactBoundaries.has(ordered[atIndex].viewport.width)) continue;
        const discontinuity = [...ids].some((id) => {
            const before = flattened[beforeIndex].nodes.get(id), at = flattened[atIndex].nodes.get(id),
                after = flattened[afterIndex].nodes.get(id);
            if (!before || !at || !after) return false;
            return (['x', 'y', 'width', 'height'] as const).some((key) =>
                Math.abs((at.rect[key] - before.rect[key]) - (after.rect[key] - at.rect[key])) > 2);
        });
        if (discontinuity) globalExactBoundaries.add(ordered[atIndex].viewport.width);
    }
    const inferAxisVariants = (sourceId: string, samples: Sample[], axis: 'horizontal' | 'vertical') => {
        const boundaries = [...globalExactBoundaries].sort((a, b) => a - b);
        const groups = new Map<number, Sample[]>();
        for (const sample of samples) {
            const group = boundaries.filter((boundary) => sample.viewport >= boundary).length;
            (groups.get(group) ?? groups.set(group, []).get(group)!).push(sample);
        }
        const raw = [...groups].sort(([a], [b]) => a - b).map(([, group]) => ({
            constraint: inferAxis(sourceId, group, axis), firstViewport: group[0].viewport,
        }));
        const compact: typeof raw = [];
        for (const candidate of raw) {
            if (compact.length && JSON.stringify(compact.at(-1)!.constraint) === JSON.stringify(candidate.constraint))
                continue;
            compact.push(candidate);
        }
        const variants: ResponsiveAxisVariant[] = compact.map(({ constraint }) => ({ constraint }));
        for (let i = 0; i + 1 < variants.length; ++i) {
            const nextFirst = compact[i + 1].firstViewport;
            const prior = ordered.map((capture) => capture.viewport.width).filter((width) => width < nextFirst).at(-1)!;
            variants[i].transitionToNext = { lowerBound: prior, upperBound: nextFirst, confidence: 'measured' };
        }
        return variants;
    };
    const constraints = new Map<string, TypedResponsiveConstraints>();
    const diagnostics: ResponsiveDiagnostic[] = [];
    let structuralVariants = 0;
    for (const sourceId of [...ids].sort()) {
        const byViewport: Array<Sample | undefined> = ordered.map((capture, index) => {
            const node = flattened[index].nodes.get(sourceId);
            return node ? { captureIndex: index, viewport: capture.viewport.width, viewportHeight: capture.viewport.height,
                node, parent: flattened[index].parents.get(sourceId) } : undefined;
        });
        const samples = byViewport.filter((sample): sample is Sample => !!sample);
        const presence = byViewport.map(Boolean);
        const transitions = presence.slice(1).filter((value, index) => value !== presence[index]).length;
        if (transitions > 1) {
            diagnostics.push({ sourceId, code: 'non-monotonic-visibility', message: `structural presence is non-monotonic across ${ordered.map((capture) => capture.viewport.width).join(',')}` });
            continue;
        }
        if (samples.length !== ordered.length) structuralVariants++;
        const geometrySamples = samples.filter((sample) => sample.node.computedStyle.display !== 'none' && sample.node.rect.width > 0 && sample.node.rect.height > 0);
        if (geometrySamples.length === 0) {
            diagnostics.push({ sourceId, code: 'ambiguous-axis', message: `responsive node ${sourceId} is hidden in every capture` });
        } else {
            const inferIndependentAxis = (axis: 'horizontal' | 'vertical') => {
                const axisSamples = geometrySamples.filter((sample) => axis === 'horizontal'
                    ? sample.viewportHeight === ordered[horizontalIndices[0]].viewport.height
                    : verticalIndices.has(sample.captureIndex));
                try { return { constraint: inferAxis(sourceId, axisSamples, axis) }; }
                catch (singleError) {
                    try {
                        const variants = inferAxisVariants(sourceId, axisSamples, axis);
                        return { constraint: variants[0].constraint, variants };
                    } catch (variantError) {
                        diagnostics.push({ sourceId, code: 'ambiguous-axis',
                            message: `${axis}: ${String(variantError)}; unsegmented: ${String(singleError)}` });
                        return {};
                    }
                }
            };
            const horizontal = inferIndependentAxis('horizontal');
            const vertical = inferIndependentAxis('vertical');
            if (horizontal.constraint || vertical.constraint) {
            let visibilityVariants: ResponsiveVisibilityVariant[];
            let responsiveLayoutVariants: ResponsiveLayoutVariant[];
            try {
                visibilityVariants = visibility(byViewport.map((sample, index) => ({
                    viewport: ordered[index].viewport.width,
                    viewportHeight: ordered[index].viewport.height,
                    present: !!sample,
                    visible: !!sample && sample.node.computedStyle.display !== 'none' &&
                        sample.node.rect.width > 0 && sample.node.rect.height > 0,
                })));
                responsiveLayoutVariants = layoutVariants(samples);
            } catch (error) {
                diagnostics.push({ sourceId, code: 'ambiguous-2d-variant', message: String(error) });
                continue;
            }
            constraints.set(sourceId, {
                ...(horizontal.constraint ? { horizontal: horizontal.constraint } : {}),
                ...(vertical.constraint ? { vertical: vertical.constraint } : {}),
                ...(horizontal.variants ? { horizontalVariants: horizontal.variants } : {}),
                ...(vertical.variants ? { verticalVariants: vertical.variants } : {}),
                visibility: visibilityVariants, layoutVariants: responsiveLayoutVariants,
                sampledViewports: [...new Set(ordered.map((capture) => capture.viewport.width))],
            });
            }
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
            ambiguous: diagnostics.filter((item) => item.code === 'ambiguous-axis' || item.code === 'ambiguous-2d-variant' || item.code === 'non-monotonic-visibility').length,
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
        const children = new Map<string, IRNode[]>();
        for (const variant of variants) for (const child of variant.children) {
            const id = identity(child);
            if (!children.has(id)) children.set(id, []);
            children.get(id)!.push(child);
        }
        // The reference (last/widest) capture is the canonical DOM order. A
        // branch that appears only outside that reference is appended by
        // durable identity, never by capture traversal history.
        const baseOrder = base.children.map(identity);
        const baseIds = new Set(baseOrder);
        const order = [...baseOrder, ...[...children.keys()].filter((id) => !baseIds.has(id)).sort()];
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
