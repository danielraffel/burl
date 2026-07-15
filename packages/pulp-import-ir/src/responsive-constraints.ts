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
export interface ApplicationStatePropertyPatch {
    layout?: Record<string, string>;
    paint?: Record<string, string>;
    style?: Record<string, string>;
    visible?: boolean;
}
export interface ApplicationStatePredicate {
    key: string;
    value: string;
}
export interface ApplicationStateVariant extends ApplicationStatePropertyPatch {
    key: string;
    value: string;
    when?: ApplicationStatePredicate[];
}
export interface TypedResponsiveConstraints {
    horizontal?: ResponsiveAxisConstraint;
    vertical?: ResponsiveAxisConstraint;
    horizontalVariants?: ResponsiveAxisVariant[];
    verticalVariants?: ResponsiveAxisVariant[];
    visibility: ResponsiveVisibilityVariant[];
    layoutVariants: ResponsiveLayoutVariant[];
    applicationStateKey?: string;
    /** Captured initial value for applicationStateKey; never inferred from cohort order. */
    applicationStateDefaultValue?: string;
    visibilityByApplicationState?: Record<string, boolean>;
    applicationStateWhen?: ApplicationStatePredicate[];
    applicationStateBase?: ApplicationStatePropertyPatch;
    applicationStateVariants?: ApplicationStateVariant[];
    sampledViewports: number[];
}
export interface ResponsiveDiagnostic {
    sourceId: string;
    code: 'ambiguous-axis' | 'ambiguous-2d-variant' | 'non-monotonic-visibility' |
        'bounded-breakpoint' | 'terminal-fixed-fluid-height';
    message: string;
    severity?: 'warning' | 'error';
}
export interface ResponsiveMatchReport { matched: number; structuralVariants: number; unmatched: number; ambiguous: number }
export interface ResponsiveReconciliation {
    constraints: Map<string, TypedResponsiveConstraints>;
    intrinsicWidthIds: Set<string>;
    intrinsicHeightIds: Set<string>;
    diagnostics: ResponsiveDiagnostic[];
    matchReport: ResponsiveMatchReport;
}
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
// Responsive ratios participate in flex line breaking, where the sum of
// several rounded child percentages plus exact gaps is compared directly to
// the container width. Four decimal places can accumulate enough positive
// error to create a spurious wrap even though the captured children occupy one
// line. Nine preserves sub-micropixel reconstruction accuracy at desktop
// widths. Six is not sufficient for exact-fit rows: rounding a fitted ratio
// by 5e-7 can undersize a 1200 px descendant by roughly 0.0006 px, which is
// enough for Yoga to move the last item onto a new flex line. Nine remains far
// above source-engine floating-point noise while keeping serialized evidence
// stable and readable.
const rounded = (n: number) => Math.round(n * 1000000000) / 1000000000;

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
    // Breakpoint triplets can leave only W and W+1 in the terminal segment.
    // A genuinely fluid child then has a 0.5 px fixed residual, but an exact
    // fill model. Preserve the observed slope whenever the size actually
    // changes; otherwise imports freeze at the widest capture and crop when
    // the native window grows beyond it.
    if (Math.abs(fit.ratio - 1) <= 0.03 && fit.residual <= 1)
        return { kind: 'fill', offset: rounded(fit.offset), residual: rounded(fit.residual) };
    // A non-binding authored min-width (commonly `min-width: 0`) must not
    // replace a proven fill relationship with a one-way lower bound. Native
    // layout otherwise shrinks the box to content and loses right anchoring.
    const authoredClamp = boundedCandidate('max', authoredMax) ?? boundedCandidate('min', authoredMin);
    if (authoredClamp) return authoredClamp;
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

function layoutVariants(samples: Sample[], viewportWindowedIds: ReadonlySet<string> = new Set()): ResponsiveLayoutVariant[] {
    let ordered = [...samples].sort((a, b) => a.viewport - b.viewport || a.viewportHeight - b.viewportHeight);
    const isFlex = (sample: Sample) => ['flex', 'inline-flex'].includes(sample.node.computedStyle.display);
    const flowLiteralKeys = [
        'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'gap', 'rowGap', 'columnGap', 'top', 'right', 'bottom', 'left',
        'overflowX', 'overflowY',
    ] as const;
    const textLayoutLiteralKeys = [
        'whiteSpace', 'textOverflow', 'overflowWrap', 'wordWrap',
    ] as const;
    const authoredSizingKeys = (['width', 'height', 'minWidth', 'minHeight',
        'maxWidth', 'maxHeight', 'flexBasis', 'flexGrow', 'flexShrink'] as const).filter((property) =>
        samples.every((sample) => {
            const winner = sample.node.styleProvenanceWinners?.[property]?.trim().toLowerCase();
            if (winner !== undefined) return winner !== 'auto' && winner !== '';
            return (sample.node.styleProvenance?.[property] ?? [])
                .some((declaration) => declaration.origin === 'authored');
        }));
    const literalKeys = [...flowLiteralKeys, ...textLayoutLiteralKeys, ...authoredSizingKeys];
    const changingLiteralKeys = literalKeys.filter((property) =>
        new Set(ordered.map((sample) => sample.node.computedStyle[property] ?? '')).size > 1);
    const literals = (sample: Sample) => Object.fromEntries(changingLiteralKeys.flatMap((property) => {
        const value = sample.node.computedStyle[property];
        return value === undefined || value === '' ? [] : [[property, value]];
    }));
    const canonicalOrder = ordered.at(-1)!.node.children.map((child) => child.sourceId);
    const childOrder = (sample: Sample) => {
        const out = sample.node.children.map((child) => child.sourceId);
        for (const id of canonicalOrder) {
            if (!viewportWindowedIds.has(id) || out.includes(id)) continue;
            const canonicalIndex = canonicalOrder.indexOf(id);
            const next = canonicalOrder.slice(canonicalIndex + 1).find((candidate) => out.includes(candidate));
            if (next !== undefined) out.splice(out.indexOf(next), 0, id);
            else {
                const previous = canonicalOrder.slice(0, canonicalIndex).reverse()
                    .find((candidate) => out.includes(candidate));
                if (previous !== undefined) out.splice(out.indexOf(previous) + 1, 0, id);
                else out.push(id);
            }
        }
        return out;
    };
    const key = (sample: Sample) => `${isFlex(sample) ? sample.node.computedStyle.flexDirection ?? '' : ''}|${isFlex(sample) ? sample.node.computedStyle.flexWrap ?? '' : ''}|${reflowed(sample.node)}|${JSON.stringify(literals(sample))}|${childOrder(sample).join('\u0000')}`;
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
            childOrder: childOrder(ordered[start]),
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
    const flowChildren = node.children.filter((child) =>
        !['absolute', 'fixed'].includes((child.computedStyle.position ?? '').toLowerCase()) &&
        (child.computedStyle.display ?? '').toLowerCase() !== 'none');
    if (flowChildren.length < 2) return false;
    const rows = new Set(flowChildren.map((child) => Math.round(child.rect.y * 2) / 2));
    return rows.size > 1 && (node.computedStyle.flexWrap === 'wrap' || node.computedStyle.display === 'block');
}

function containsWrappedReflow(node: ObservedDomNode): boolean {
    return (node.computedStyle.flexWrap === 'wrap' && reflowed(node)) ||
        node.children.some(containsWrappedReflow);
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
    const canonicalHorizontalHeight = ordered[horizontalIndices[0]].viewport.height;
    const verticalIndices = new Set(verticalSlice.distinctCount > 1
        ? verticalSlice.indices : ordered.map((_, index) => index));
    const globalExactBoundaries = new Set<number>();
    const exactLayoutProperties = [
        'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
        'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'gap', 'rowGap', 'columnGap', 'top', 'right', 'bottom', 'left',
    ] as const;
    for (let position = 1; position < horizontalIndices.length; ++position) {
        const beforeIndex = horizontalIndices[position - 1], afterIndex = horizontalIndices[position];
        if (ordered[afterIndex].viewport.width - ordered[beforeIndex].viewport.width !== 1) continue;
        const changed = [...ids].some((id) => {
            const before = flattened[beforeIndex].nodes.get(id), after = flattened[afterIndex].nodes.get(id);
            if (!before || !after) return before !== after;
            return before.computedStyle.display !== after.computedStyle.display ||
                before.computedStyle.flexDirection !== after.computedStyle.flexDirection ||
                before.computedStyle.flexWrap !== after.computedStyle.flexWrap ||
                exactLayoutProperties.some((property) =>
                    before.computedStyle[property] !== after.computedStyle[property]) ||
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
        if (axis === 'vertical') {
            const boundaries = [...globalExactBoundaries].sort((a, b) => a - b);
            const byWidth = new Map<number, Sample[]>();
            for (const sample of samples)
                (byWidth.get(sample.viewport) ?? byWidth.set(sample.viewport, []).get(sample.viewport)!).push(sample);
            const repeated = [...byWidth].filter(([, group]) =>
                new Set(group.map((sample) => sample.viewportHeight)).size > 1)
                .sort(([a], [b]) => a - b)
                .map(([width, group]) => ({
                    constraint: inferAxis(sourceId, group, axis),
                    firstViewport: width,
                    lastViewport: width,
                }));
            const raw: typeof repeated = [];
            if (repeated.length) {
                const predictedSize = (constraint: ResponsiveAxisConstraint, sample: Sample) => {
                    const container = sample.parent?.rect.height ?? sample.viewportHeight;
                    const linearValue = (constraint.ratio ??
                        (constraint.kind === 'fill' ? 1 : 0)) * container + (constraint.offset ?? 0);
                    if (constraint.kind === 'fixed') return constraint.value!;
                    if (constraint.kind === 'min') return Math.max(linearValue, constraint.min!);
                    if (constraint.kind === 'max') return Math.min(linearValue, constraint.max!);
                    if (constraint.kind === 'clamp')
                        return Math.min(Math.max(linearValue, constraint.min!), constraint.max!);
                    return linearValue;
                };
                // A same-width height slice establishes the cross-axis model,
                // but widths captured at only one height still carry real
                // reflow evidence. Reuse the nearest established model when
                // it predicts that singleton. When it does not, retain the
                // measured singleton as a width-qualified fixed segment
                // instead of borrowing geometry from another width.
                for (const [width, group] of [...byWidth].sort(([a], [b]) => a - b)) {
                    const established = repeated.find((candidate) => candidate.firstViewport === width);
                    if (established) {
                        raw.push(established);
                        continue;
                    }
                    const nearest = [...repeated].sort((a, b) =>
                        Math.abs(a.firstViewport - width) - Math.abs(b.firstViewport - width))[0];
                    const matches = group.every((sample) =>
                        Math.abs(predictedSize(nearest.constraint, sample) - sample.node.rect.height) <=
                            Math.max(1, nearest.constraint.residual + 1));
                    raw.push({
                        constraint: matches ? nearest.constraint : inferAxis(sourceId, group, axis),
                        firstViewport: width,
                        lastViewport: width,
                    });
                }
            } else {
                // Some cross-axis used sizes change only at a width media
                // breakpoint (for example a zero-height separator becoming a
                // stretched 12px separator). There is no same-width height
                // slice to regress in that case, so qualify the vertical
                // constraint by the proven width boundaries.
                const groups = new Map<number, Sample[]>();
                for (const sample of samples) {
                    const group = boundaries.filter((boundary) => sample.viewport >= boundary).length;
                    (groups.get(group) ?? groups.set(group, []).get(group)!).push(sample);
                }
                const widthQualified = [...groups].sort(([a], [b]) => a - b).map(([, group]) => ({
                    constraint: inferAxis(sourceId, group, axis),
                    firstViewport: group[0].viewport,
                    lastViewport: group.at(-1)!.viewport,
                }));
                raw.push(...widthQualified);
            }
            const compact: typeof raw = [];
            for (const candidate of raw) {
                if (compact.length && JSON.stringify(compact.at(-1)!.constraint) === JSON.stringify(candidate.constraint)) {
                    compact.at(-1)!.lastViewport = candidate.lastViewport;
                    continue;
                }
                compact.push(candidate);
            }
            const variants: ResponsiveAxisVariant[] = compact.map(({ constraint }) => ({ constraint }));
            for (let i = 0; i + 1 < variants.length; ++i) {
                const exact = boundaries.find((boundary) =>
                    boundary > compact[i].lastViewport && boundary <= compact[i + 1].firstViewport);
                const upperBound = exact ?? compact[i + 1].firstViewport;
                const lowerBound = exact
                    ? samples.map((sample) => sample.viewport).filter((width) => width < exact).at(-1)!
                    : compact[i].lastViewport;
                variants[i].transitionToNext = { lowerBound, upperBound,
                    confidence: upperBound - lowerBound === 1 ? 'measured' : 'bounded',
                    axis: 'width' };
            }
            return variants;
        }
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
    const intrinsicWidthIds = new Set<string>();
    const intrinsicHeightIds = new Set<string>();
    const diagnostics: ResponsiveDiagnostic[] = [];
    const viewportWindowedIds = new Set<string>();
    const collectionRoles = new Set(['feed', 'grid', 'list', 'listbox', 'log', 'table', 'tree']);
    for (const sourceId of ids) {
        const presenceByWidth = new Map<number, Set<boolean>>();
        flattened.forEach(({ nodes }, index) => {
            const states = presenceByWidth.get(ordered[index].viewport.width) ?? new Set<boolean>();
            states.add(nodes.has(sourceId));
            presenceByWidth.set(ordered[index].viewport.width, states);
        });
        if (![...presenceByWidth.values()].some((states) => states.size > 1)) continue;
        const presentIndex = flattened.findIndex(({ nodes }) => nodes.has(sourceId));
        if (presentIndex < 0) continue;
        let ancestor = flattened[presentIndex].parents.get(sourceId);
        let hasStableCollection = false, hasStableScrollViewport = false;
        while (ancestor) {
            const stable = flattened.every(({ nodes }) => nodes.has(ancestor!.sourceId));
            if (stable) {
                const role = ancestor.attributes?.role?.toLowerCase();
                if (role && collectionRoles.has(role)) hasStableCollection = true;
                if (['auto', 'scroll'].includes(ancestor.computedStyle.overflowY?.toLowerCase() ?? ''))
                    hasStableScrollViewport = true;
            }
            ancestor = flattened[presentIndex].parents.get(ancestor.sourceId);
        }
        if (hasStableCollection && hasStableScrollViewport) viewportWindowedIds.add(sourceId);
    }
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
        if (samples.length !== ordered.length && !viewportWindowedIds.has(sourceId)) structuralVariants++;
        // Zero used size is still valid layout evidence. Separators, spacers,
        // collapsed tracks, and empty intrinsic boxes can retain margins and
        // participate in flow at zero width or height. Only CSS-hidden samples
        // are absent from the geometry oracle.
        const geometrySamples = samples.filter((sample) =>
            sample.node.computedStyle.display !== 'none' &&
            sample.node.computedStyle.visibility !== 'hidden' &&
            sample.node.computedStyle.visibility !== 'collapse');
        if (geometrySamples.length === 0) {
            diagnostics.push({ sourceId, code: 'ambiguous-axis', message: `responsive node ${sourceId} is hidden in every capture` });
        } else {
            const px = (value: string | undefined) => {
                const parsed = Number.parseFloat(value ?? '0');
                return Number.isFinite(parsed) ? parsed : 0;
            };
            const ownsNoExplicitAuthoredHeight = (sample: Sample) => {
                const winner = sample.node.styleProvenanceWinners?.height?.trim().toLowerCase();
                if (winner !== undefined) return winner === 'auto';
                return !(sample.node.styleProvenance?.height ?? []).some((declaration) =>
                    declaration.origin === 'authored');
            };
            const authoredHeightVariesByViewport =
                new Set(geometrySamples.map((sample) => sample.node.computedStyle.height ?? '')).size > 1 &&
                geometrySamples.every((sample) => !ownsNoExplicitAuthoredHeight(sample));
            const stableHeightsByViewport = [...new Map(geometrySamples.map((sample) => [sample.viewport,
                geometrySamples.filter((candidate) => candidate.viewport === sample.viewport)
                    .map((candidate) => candidate.node.rect.height)])).values()]
                .every((heights) => Math.max(...heights) - Math.min(...heights) <= 0.5);
            const changingHeight = geometrySamples.length >= 3 &&
                new Set(geometrySamples.map((sample) => Math.round(sample.node.rect.height * 2) / 2)).size > 1 &&
                stableHeightsByViewport;
            const contentHugContainerHeight = changingHeight &&
                geometrySamples.every(ownsNoExplicitAuthoredHeight) &&
                geometrySamples.every((sample) => {
                    const children = sample.node.children.filter((child) =>
                        !['absolute', 'fixed'].includes((child.computedStyle.position ?? '').toLowerCase()));
                    if (!children.length ||
                        Number.parseFloat(sample.node.computedStyle.flexGrow ?? '0') > 0)
                        return false;
                    // A computed `height: Npx` is only a used-value receipt
                    // when no authored height won. Prove content-hugging from
                    // the observed flow edge instead of freezing N into a
                    // width breakpoint. This covers arbitrary auto-height
                    // containers (forms, input groups, tool cards), not only
                    // one-child text wrappers.
                    const contentBottom = Math.max(...children.map((child) =>
                        child.rect.y + child.rect.height + px(child.computedStyle.marginBottom)));
                    const expected = contentBottom - sample.node.rect.y +
                        px(sample.node.computedStyle.paddingBottom) + px(sample.node.computedStyle.borderBottomWidth);
                    return Math.abs(expected - sample.node.rect.height) <= 1.5;
                });
            const contentHugTextHeight = changingHeight && geometrySamples.every((sample) => {
                if (sample.node.children.length > 0 ||
                    Number.parseFloat(sample.node.computedStyle.flexGrow ?? '0') > 0) return false;
                const authoredHeight = (sample.node.styleProvenance?.height ?? [])
                    .some((declaration) => declaration.origin === 'authored');
                const winner = sample.node.styleProvenanceWinners?.height?.trim().toLowerCase();
                if (authoredHeight || (winner !== undefined && winner !== 'auto')) return false;
                const textRects = (sample.node.content ?? []).flatMap((item) =>
                    item.kind === 'text' && item.text.trim() && item.rect ? [item.rect] : []);
                if (!textRects.length) return false;
                const contentTop = Math.min(...textRects.map((rect) => rect.y));
                const contentBottom = Math.max(...textRects.map((rect) => rect.y + rect.height));
                const contentHeight = contentBottom - contentTop;
                const lineHeight = Number.parseFloat(sample.node.computedStyle.lineHeight ?? '');
                return contentHeight <= sample.node.rect.height + 0.5 &&
                    sample.node.rect.height - contentHeight <=
                        (Number.isFinite(lineHeight) ? lineHeight : 1);
            });
            const contentHugTextWidth = geometrySamples.every((sample) => {
                if (sample.node.children.length > 0 ||
                    Number.parseFloat(sample.node.computedStyle.flexGrow ?? '0') > 0)
                    return false;
                const widthWinner = sample.node.styleProvenanceWinners?.width?.trim().toLowerCase();
                const authoredWidth = (sample.node.styleProvenance?.width ?? []).some((declaration) =>
                    declaration.origin === 'authored');
                if (authoredWidth || (widthWinner !== undefined && widthWinner !== 'auto'))
                    return false;
                if (!['nowrap', 'pre'].includes(
                    (sample.node.computedStyle.whiteSpace ?? 'normal').toLowerCase()))
                    return false;
                const textRects = (sample.node.content ?? []).flatMap((item) =>
                    item.kind === 'text' && item.text.trim() && item.rect ? [item.rect] : []);
                if (!textRects.length) return false;
                const contentLeft = Math.min(...textRects.map((rect) => rect.x));
                const contentRight = Math.max(...textRects.map((rect) => rect.x + rect.width));
                const contentWidth = contentRight - contentLeft;
                const expected = contentWidth + px(sample.node.computedStyle.paddingLeft) +
                    px(sample.node.computedStyle.paddingRight) +
                    px(sample.node.computedStyle.borderLeftWidth) +
                    px(sample.node.computedStyle.borderRightWidth);
                // DOMSnapshot text fragments retain their unellipsized range
                // width. Equality therefore proves a content-sized label,
                // while a wider text fragment proves a genuinely constrained
                // ellipsis box whose captured width must remain authoritative.
                return Math.abs(expected - sample.node.rect.width) <= 1.0;
            });
            if (contentHugTextWidth) intrinsicWidthIds.add(sourceId);
            if (contentHugContainerHeight || contentHugTextHeight) intrinsicHeightIds.add(sourceId);
            const inferIndependentAxis = (axis: 'horizontal' | 'vertical') => {
                // A browser-reported used width is geometry evidence, not an
                // authored sizing instruction. Initial `width:auto` is
                // intrinsic on a flex main axis, but fills the containing
                // block or a stretched flex/grid cross axis. Suppress only
                // the intrinsic case; the stretch relationship must survive
                // block-to-flex lowering and nested responsive resolution.
                const ownsNoAuthoredWidth = (sample: Sample) =>
                    (sample.node.styleProvenanceComplete === true ||
                     sample.node.styleProvenanceCompleteProperties?.includes('width') === true) &&
                    sample.node.styleProvenance !== undefined &&
                    (sample.node.styleProvenanceWinners?.width !== undefined
                        ? sample.node.styleProvenanceWinners.width.trim().toLowerCase() === 'auto'
                        : !(sample.node.styleProvenance.width ?? []).some((declaration) =>
                            declaration.origin !== 'inherited'));
                const containmentStretchesAutoWidth = (sample: Sample) => {
                    const parent = sample.parent;
                    if (!parent) return false;
                    const display = (parent.computedStyle.display ?? '').toLowerCase();
                    if (display === 'grid' || display === 'inline-grid') {
                        const justifySelf = (sample.node.computedStyle.justifySelf ?? 'auto').toLowerCase();
                        const justifyItems = (parent.computedStyle.justifyItems ?? 'normal').toLowerCase();
                        return justifySelf === 'stretch' ||
                            (justifySelf === 'auto' && (justifyItems === 'stretch' || justifyItems === 'normal'));
                    }
                    if (display === 'flex' || display === 'inline-flex') {
                        const direction = (parent.computedStyle.flexDirection ?? 'row').toLowerCase();
                        if (!direction.startsWith('column')) return false;
                        const alignSelf = (sample.node.computedStyle.alignSelf ?? 'auto').toLowerCase();
                        const alignItems = (parent.computedStyle.alignItems ?? 'normal').toLowerCase();
                        return alignSelf === 'stretch' ||
                            (alignSelf === 'auto' && (alignItems === 'stretch' || alignItems === 'normal'));
                    }
                    return (sample.node.computedStyle.display ?? '').toLowerCase() === 'block';
                };
                const authoredFluidHeight = (sample: Sample) => {
                    const ownsNoHeight = ownsNoAuthoredHeight(sample);
                    return ownsNoHeight &&
                        Number.parseFloat(sample.node.computedStyle.flexGrow ?? '0') > 0;
                };
                const parentOwnsVerticalFlexSize = (sample: Sample) => {
                    const parent = sample.parent;
                    if (!parent || Number.parseFloat(sample.node.computedStyle.flexGrow ?? '0') <= 0)
                        return false;
                    const display = (parent.computedStyle.display ?? '').toLowerCase();
                    const direction = (parent.computedStyle.flexDirection ?? 'row').toLowerCase();
                    return ['flex', 'inline-flex'].includes(display) && direction.startsWith('column');
                };
                const ownsNoAuthoredHeight = (sample: Sample) => {
                    const winner = sample.node.styleProvenanceWinners?.height?.trim().toLowerCase();
                    return winner === 'auto' || (
                        (sample.node.styleProvenanceComplete === true ||
                         sample.node.styleProvenanceCompleteProperties?.includes('height') === true) &&
                        sample.node.styleProvenance !== undefined &&
                        !(sample.node.styleProvenance.height ?? []).some((declaration) =>
                            declaration.origin !== 'inherited'));
                };
                const hasIntrinsicTextHeight = (sample: Sample) => {
                    const authoredHeight = (sample.node.styleProvenance?.height ?? [])
                        .some((declaration) => declaration.origin === 'authored');
                    const winner = sample.node.styleProvenanceWinners?.height?.trim().toLowerCase();
                    if (authoredHeight || (winner !== undefined && winner !== 'auto')) return false;
                    if (sample.node.children.length) return false;
                    const textRects = (sample.node.content ?? []).flatMap((item) =>
                        item.kind === 'text' && item.text.trim() && item.rect ? [item.rect] : []);
                    if (!textRects.length) return false;
                    const contentTop = Math.min(...textRects.map((rect) => rect.y));
                    const contentBottom = Math.max(...textRects.map((rect) => rect.y + rect.height));
                    const contentHeight = contentBottom - contentTop;
                    const lineHeight = Number.parseFloat(sample.node.computedStyle.lineHeight ?? '');
                    return contentHeight <= sample.node.rect.height + 0.5 &&
                        sample.node.rect.height - contentHeight <=
                            (Number.isFinite(lineHeight) ? lineHeight : 1);
                };
                if (axis === 'horizontal' && intrinsicWidthIds.has(sourceId)) return {};
                if (axis === 'horizontal' && geometrySamples.every(ownsNoAuthoredWidth) &&
                    !geometrySamples.every(containmentStretchesAutoWidth)) return {};
                if (axis === 'vertical' && authoredHeightVariesByViewport) return {};
                // A positive-flex child on a column main axis receives the
                // parent's remaining height after intrinsic/fixed siblings
                // are measured. Its browser used height therefore varies
                // with both viewport and sibling reflow; projecting that used
                // value as an independent equation leaves stale empty space.
                if (axis === 'vertical' && geometrySamples.every(parentOwnsVerticalFlexSize)) return {};
                // The canonical height slice prevents a factorial capture
                // matrix from weighting repeated widths more heavily. It may
                // not contain every measured width, however: minimum-window
                // evidence is often captured only at its minimum viable
                // height. Retain exactly one representative for every width,
                // preferring the canonical height and otherwise the nearest
                // measured height. This keeps the regression one-dimensional
                // without silently discarding a supported width boundary.
                const horizontalRepresentatives = () => {
                    const byWidth = new Map<number, Sample[]>();
                    for (const sample of geometrySamples)
                        (byWidth.get(sample.viewport) ??
                            byWidth.set(sample.viewport, []).get(sample.viewport)!).push(sample);
                    return [...byWidth].sort(([a], [b]) => a - b).map(([, group]) =>
                        [...group].sort((a, b) =>
                            Math.abs(a.viewportHeight - canonicalHorizontalHeight) -
                                Math.abs(b.viewportHeight - canonicalHorizontalHeight) ||
                            b.viewportHeight - a.viewportHeight)[0]);
                };
                const axisSamples = axis === 'horizontal'
                    ? horizontalRepresentatives()
                    : geometrySamples.filter((sample) => verticalIndices.has(sample.captureIndex));
                // Intrinsic content normally owns its height. A flex-wrap or
                // block-flow container is the important exception: browser
                // capture can prove that its in-flow children occupy multiple
                // rows at a narrower width while the canonical lowered tree
                // still carries the browser-used pixel height. Preserve the
                // intrinsic dimension, but attach the captured height as a
                // width-selected minimum floor. A min-only constraint does
                // not replace Yoga measurement and therefore cannot freeze
                // ordinary wrapped text or non-reflowing auto-height forms.
                if (axis === 'vertical' && intrinsicHeightIds.has(sourceId)) {
                    if (!geometrySamples.some((sample) => containsWrappedReflow(sample.node))) return {};
                    try {
                        const variants = inferAxisVariants(sourceId, geometrySamples, axis);
                        if (variants.length <= 1 || variants.some(({ constraint }) =>
                            constraint.kind !== 'fixed' || constraint.value === undefined)) return {};
                        const floors = variants.map((variant) => ({
                            ...variant,
                            constraint: {
                                kind: 'min' as const,
                                min: variant.constraint.value,
                                residual: variant.constraint.residual,
                            },
                        }));
                        return { constraint: floors[0].constraint, variants: floors };
                    } catch {
                        return {};
                    }
                }
                try {
                    const constraint = inferAxis(sourceId, axisSamples, axis);
                    if (axis === 'vertical') {
                        try {
                            const variants = inferAxisVariants(sourceId, geometrySamples, axis);
                            // An auto-height box whose used height changes only
                            // because its contents wrap is intrinsically sized.
                            // Freezing those browser-used heights into width
                            // variants overrides Yoga/text measurement and can
                            // double-count wrapped content at an intermediate
                            // width. Preserve a constant harmless fixed receipt,
                            // but let intrinsic layout own changing auto heights.
                            if (variants.length > 1 && intrinsicHeightIds.has(sourceId)) return {};
                            if (variants.length > 1 &&
                                variants.at(-1)?.constraint.kind === 'fixed' &&
                                geometrySamples.every(authoredFluidHeight)) {
                                diagnostics.push({
                                    sourceId,
                                    code: 'terminal-fixed-fluid-height',
                                    severity: 'error',
                                    message: 'terminal width segment freezes an authored auto-height flex item; add same-width height captures instead of treating a used height as authored sizing',
                                });
                            }
                            if (variants.length > 1) return { constraint: variants[0].constraint, variants };
                        } catch {
                            // The canonical same-width height slice remains the
                            // fail-closed vertical oracle when other width
                            // segments do not each contain enough evidence.
                        }
                    }
                    return { constraint };
                }
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
            const requiresStateConstraint = samples.length !== ordered.length ||
                geometrySamples.length !== samples.length;
            if (horizontal.constraint || vertical.constraint || requiresStateConstraint) {
            let visibilityVariants: ResponsiveVisibilityVariant[];
            let responsiveLayoutVariants: ResponsiveLayoutVariant[];
            try {
                visibilityVariants = visibility(byViewport.map((sample, index) => ({
                    viewport: ordered[index].viewport.width,
                    viewportHeight: ordered[index].viewport.height,
                    present: viewportWindowedIds.has(sourceId) || !!sample,
                    visible: viewportWindowedIds.has(sourceId) || (!!sample &&
                        sample.node.computedStyle.display !== 'none' &&
                        sample.node.computedStyle.visibility !== 'hidden' &&
                        sample.node.computedStyle.visibility !== 'collapse'),
                })));
                responsiveLayoutVariants = layoutVariants(samples, viewportWindowedIds);
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
        for (let index = 0; index < variants.length; ++index) {
            const variant = variants[index];
            if (variant.transitionToNext?.confidence !== 'bounded') continue;
            const structuralTransition = variant.structural || variants[index + 1]?.structural === true;
            // A missing structural ancestor necessarily makes every descendant
            // missing too. Diagnose the highest uncertain branch once rather
            // than emitting a fatal error for every node in that subtree.
            const parentId = flattened.map(({ parents }) => parents.get(sourceId)?.sourceId)
                .find((candidate): candidate is string => candidate !== undefined);
            const inheritedStructuralTransition = parentId !== undefined && flattened.every(({ nodes }) =>
                nodes.has(sourceId) === nodes.has(parentId));
            if (structuralTransition && inheritedStructuralTransition) continue;
            diagnostics.push({
                sourceId,
                code: 'bounded-breakpoint',
                // Guessing inside a bounded interval can select the wrong DOM
                // branch, not merely approximate its geometry. Structural
                // responsive imports therefore fail closed until the capture
                // cohort contains the exact boundary (normally W-1/W).
                severity: structuralTransition ? 'error' : 'warning',
                message: `breakpoint is bounded to (${variant.transitionToNext.lowerBound}, ${variant.transitionToNext.upperBound}); exact runtime parity requires authored media-query evidence or binary-search capture`,
            });
        }
    }
    // Intrinsic block sizing propagates through otherwise anonymous wrapper
    // layers. A common DOM shape is text -> padded bubble -> alignment shell;
    // the shell has no text of its own, but its used height still follows the
    // already-proven intrinsic child. Resolve that relationship to a fixed
    // point so arbitrary wrapper depth does not freeze a wide-capture height.
    let promotedAncestor = true;
    while (promotedAncestor) {
        promotedAncestor = false;
        for (const sourceId of [...ids].sort()) {
            if (intrinsicHeightIds.has(sourceId)) continue;
            const samples = ordered.flatMap((capture, index) => {
                const candidate = flattened[index].nodes.get(sourceId);
                return candidate && candidate.computedStyle.display !== 'none' &&
                    candidate.rect.width > 0 && candidate.rect.height > 0
                    ? [{ captureIndex: index, viewport: capture.viewport.width,
                        viewportHeight: capture.viewport.height, node: candidate,
                        parent: flattened[index].parents.get(sourceId) }] : [];
            });
            if (samples.length < 3 || samples.some(({ node }) =>
                node.children.length !== 1 ||
                !intrinsicHeightIds.has(node.children[0].sourceId) ||
                ['absolute', 'fixed'].includes((node.children[0].computedStyle.position ?? '').toLowerCase()) ||
                Number.parseFloat(node.computedStyle.flexGrow ?? '0') > 0)) continue;
            const ownsNoAuthoredHeight = samples.every(({ node }) => {
                const winner = node.styleProvenanceWinners?.height?.trim().toLowerCase();
                if (winner !== undefined) return winner === 'auto';
                return !(node.styleProvenance?.height ?? []).some((declaration) =>
                    declaration.origin === 'authored');
            });
            if (!ownsNoAuthoredHeight) continue;
            const stableByViewport = [...new Set(samples.map(({ viewport }) => viewport))].every((viewport) => {
                const heights = samples.filter((sample) => sample.viewport === viewport)
                    .map((sample) => sample.node.rect.height);
                return Math.max(...heights) - Math.min(...heights) <= 0.5;
            });
            const changing = new Set(samples.map(({ node }) =>
                Math.round(node.rect.height * 2) / 2)).size > 1;
            const followsChild = samples.every(({ node }) => {
                const child = node.children[0];
                const px = (value: string | undefined) => {
                    const parsed = Number.parseFloat(value ?? '0');
                    return Number.isFinite(parsed) ? parsed : 0;
                };
                const expected = child.rect.y + child.rect.height - node.rect.y +
                    px(child.computedStyle.marginBottom) +
                    px(node.computedStyle.paddingBottom) +
                    px(node.computedStyle.borderBottomWidth);
                return Math.abs(expected - node.rect.height) <= 1.5;
            });
            if (!stableByViewport || !changing || !followsChild) continue;
            intrinsicHeightIds.add(sourceId);
            const responsive = constraints.get(sourceId);
            if (responsive) {
                // The wrapper is intrinsically owned, but native block/flex
                // lowering may not reproduce every browser anonymous-flow
                // contribution. Carry the source-proven wrapper extent as a
                // minimum floor, never an exact height. This preserves Yoga's
                // ability to grow for dynamic content while preventing a
                // canonical browser-used pixel height from being the only
                // thing holding the intrinsic chain open.
                try {
                    const variants = inferAxisVariants(sourceId, samples, 'vertical');
                    if (variants.length > 1 && variants.every(({ constraint }) =>
                        constraint.kind === 'fixed' && constraint.value !== undefined)) {
                        const floors = variants.map((variant) => ({
                            ...variant,
                            constraint: { kind: 'min' as const, min: variant.constraint.value,
                                residual: variant.constraint.residual },
                        }));
                        responsive.vertical = floors[0].constraint;
                        responsive.verticalVariants = floors;
                    } else {
                        delete responsive.vertical;
                        delete responsive.verticalVariants;
                    }
                } catch {
                    delete responsive.vertical;
                    delete responsive.verticalVariants;
                }
            }
            promotedAncestor = true;
        }
    }
    return {
        constraints, intrinsicWidthIds, intrinsicHeightIds, diagnostics,
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
        ...(node.source_node_id && reconciliation.intrinsicWidthIds.has(node.source_node_id)
            ? { layout: { ...(node.layout ?? {}), width: 'auto' as const,
                minWidth: 'auto' as const } } : {}),
        ...(node.source_node_id && reconciliation.intrinsicHeightIds.has(node.source_node_id)
            ? { layout: { ...(node.layout ?? {}), height: 'auto' as const,
                minHeight: 'auto' as const } } : {}),
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
        const merged: IRNode = {
            ...base,
            ...(reconciliation.intrinsicWidthIds.has(identity(base))
                ? { layout: { ...(base.layout ?? {}), width: 'auto' as const,
                    minWidth: 'auto' as const } } : {}),
            ...(reconciliation.intrinsicHeightIds.has(identity(base))
                ? { layout: { ...(base.layout ?? {}), height: 'auto' as const,
                    minHeight: 'auto' as const } } : {}),
            children: mergedChildren,
        };
        const responsive = reconciliation.constraints.get(identity(merged));
        return responsive ? { ...merged, responsive } : merged;
    };
    return merge(roots);
}
