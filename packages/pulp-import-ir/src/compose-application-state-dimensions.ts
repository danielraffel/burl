import type { IRNode } from './types.js';

export interface ProtectedApplicationStateDimension {
    key: string;
    root: IRNode;
    requiredActions?: readonly string[];
    when?: readonly { key: string; value: string }[];
    preserveWholeTreeBranches?: boolean;
    defaultValue?: string;
}

export interface ApplicationStateCompositionBudget {
    maxNodeGrowthRatio?: number;
    maxIdentityDuplication?: number;
}

export interface ApplicationStateCompositionReport {
    dimensions: string[];
    defaultNodes: number;
    composedNodes: number;
    nodeGrowthRatio: number;
    maximumIdentityDuplication: number;
}

const observedAttributesForIdentity = (node: IRNode): Record<string, string> => {
    try {
        const value = (node as any).raw_source;
        const raw = typeof value === 'string' ? JSON.parse(value) : value;
        return raw?.node?.attributes ?? {};
    } catch { return {}; }
};

const generatedSemanticIdentityCache = new WeakMap<IRNode, string>();
const localGeneratedSemanticIdentity = (node: IRNode): string => {
    const attributes = observedAttributesForIdentity(node);
    const stable = ['data-slot', 'role', 'aria-label', 'data-testid']
        .filter((key) => typeof attributes[key] === 'string' && attributes[key].trim())
        .map((key) => `${key}=${attributes[key]}`).join('|');
    const content = [
        typeof (node as any).content === 'string' ? (node as any).content : '',
        typeof (node as any).text === 'string' ? (node as any).text : '',
        typeof (node as any).text?.text === 'string' ? (node as any).text.text : '',
        ...((node as any).textRuns ?? []).map((run: any) => run?.text ?? ''),
    ].join(' ').trim();
    return `${node.tag ?? (node as any).type ?? 'node'}[${stable}]<${content}>`;
};
const generatedSemanticIdentity = (node: IRNode): string => {
    const cached = generatedSemanticIdentityCache.get(node);
    if (cached !== undefined) return cached;
    const result = `${localGeneratedSemanticIdentity(node)}(${node.children.map(generatedSemanticIdentity).join(',')})`;
    generatedSemanticIdentityCache.set(node, result);
    return result;
};

const compactIdentityHash = (value: string): string => {
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < value.length; index++) {
        hash ^= BigInt(value.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
};

const stableIdentity = (node: IRNode): string => {
    const raw = node.source_node_id ?? node.stable_anchor_id.replace(/^application-state:[^:]+::/, '');
    const normalized = raw.replace(/^dom\/html-shape-[^/]+:\d+\//, 'dom/');
    if (!/-id-_r_[^/:]*:\d+/.test(normalized)) return normalized;
    return `${normalized.replace(/-id-_r_[^/:]*:\d+/g, '-id-generated:0')}#${compactIdentityHash(generatedSemanticIdentity(node))}`;
};

// Responsive layers must resolve the same generated component identities as
// protected application-state composition. Keep one identity contract rather
// than letting a second composer invent positional correspondence.
export const protectedApplicationStateStableIdentity = (node: IRNode): string => stableIdentity(node);
export const protectedApplicationStateSemanticIdentity = (node: IRNode): string => generatedSemanticIdentity(node);
export const protectedApplicationStateLocalSemanticIdentity = (node: IRNode): string => localGeneratedSemanticIdentity(node);

const clone = <T>(value: T): T => structuredClone(value);
const countNodes = (root: IRNode): number => 1 + root.children.reduce((sum, child) => sum + countNodes(child), 0);
const subtreeIdentities = (root: IRNode): Set<string> => {
    const result = new Set<string>();
    const visit = (node: IRNode) => {
        result.add(stableIdentity(node));
        node.children.forEach(visit);
    };
    visit(root);
    return result;
};

// Whole-tree state composition keeps the canonical branch so native assets,
// platform widgets, and already-composed nested ownership survive a recapture.
// Its layout cannot remain frozen, however: a newer importer may have learned
// a more faithful lowering for the same source node (for example simple CSS
// block flow to column flex). Refresh layout only across unambiguous stable
// correspondence; every other native property remains authoritative.
const refreshProtectedLayout = (target: IRNode, source: IRNode): void => {
    // A node with scalar variants is owned by another dimension. Its base and
    // patches must be refreshed together by that owner, not partially by the
    // enclosing whole-tree capture.
    if (!(target.responsive?.applicationStateVariants?.length))
        target.layout = clone(source.layout);
    const sourceByIdentity = new Map<string, IRNode[]>();
    for (const child of source.children) {
        const identity = stableIdentity(child);
        const matches = sourceByIdentity.get(identity) ?? [];
        matches.push(child);
        sourceByIdentity.set(identity, matches);
    }
    for (const child of target.children) {
        const matches = sourceByIdentity.get(stableIdentity(child));
        if (matches?.length === 1) refreshProtectedLayout(child, matches[0]!);
    }
};
const disambiguateStateBranchAnchors = (root: IRNode): void => {
    const seen = new Set<string>();
    let instance = 0;
    const namespace = (node: IRNode, prefix: string) => {
        node.stable_anchor_id = `${prefix}::${node.stable_anchor_id}`;
        node.children.forEach((child) => namespace(child, prefix));
    };
    const visit = (node: IRNode) => {
        if (seen.has(node.stable_anchor_id) && node.responsive?.applicationStateKey) {
            const value = Object.entries(node.responsive.visibilityByApplicationState ?? {})
                .find(([, visible]) => visible)?.[0] ?? 'hidden';
            namespace(node,
                `application-state-instance:${node.responsive.applicationStateKey}:${value}:${instance++}`);
        }
        seen.add(node.stable_anchor_id);
        node.children.forEach(visit);
    };
    visit(root);
};
const structuralSignature = (node: IRNode): string =>
    `${node.tag ?? (node as any).type ?? 'node'}(${node.children.map(structuralSignature).join(',')})`;
const actionIds = (root: IRNode): Set<string> => {
    const result = new Set<string>();
    const visit = (node: IRNode) => {
        if (node.interaction?.actionBindingId) result.add(node.interaction.actionBindingId);
        const nativeAction = (node as any).attributes?.action_binding_id ?? (node as any).attributes?.pulpHostAction;
        if (nativeAction) result.add(nativeAction);
        node.children.forEach(visit);
    };
    visit(root); return result;
};

const actionBinding = (node: IRNode): string | undefined =>
    node.interaction?.actionBindingId
    ?? (node as any).attributes?.action_binding_id
    ?? (node as any).attributes?.pulpHostAction;

const nativeRouteIdentity = (node: IRNode): string =>
    (node as any).meta?.semantic_id ?? node.source_node_id ?? node.stable_anchor_id;

const authoredActionIdentity = (node: IRNode): string | undefined => {
    const segments = (node.source_node_id ?? '').split('/');
    const authored = (segment: string) => /-(?:id|data-slot|data-testid|semantic)-/.test(segment);
    if (!authored(segments.at(-1) ?? '')) return undefined;
    return segments.filter(authored).join('/');
};

const actionContentFingerprint = (node: IRNode): string | undefined => {
    const contents: string[] = [];
    const collect = (current: IRNode) => {
        const content = (current as any).content;
        if (typeof content === 'string' && content.trim()) contents.push(content.trim());
        current.children.forEach(collect);
    };
    collect(node);
    if (contents.length === 0) return undefined;
    const layout = (node as any).layout ?? {};
    return `${(node as any).type ?? node.tag ?? 'node'}|${contents.join(' ')}|${layout.width ?? 'auto'}x${layout.height ?? 'auto'}`;
};

function projectStableActionBindings(root: IRNode, dimension: ProtectedApplicationStateDimension,
    defaultIdentities: ReadonlySet<string>): void {
    const bindings = new Map<string, string>();
    const authoredBindings = new Map<string, string>();
    const contentBindings = new Map<string, string>();
    type StateTransition = { key: string; transition: string };
    const stateBindings = new Map<string, StateTransition>();
    const authoredStateBindings = new Map<string, StateTransition>();
    const contentStateBindings = new Map<string, StateTransition>();
    const payloadBindings = new Map<string, string>();
    const authoredPayloadBindings = new Map<string, string>();
    const contentPayloadBindings = new Map<string, string>();
    const stateTransition = (node: IRNode): StateTransition | undefined => {
        const attributes = (node as any).attributes;
        const key = (node as any).meta?.imported_state_key ?? attributes?.pulpStateKey;
        const transition = (node as any).meta?.imported_state_transition ?? attributes?.pulpStateTransition;
        if ((key === undefined) !== (transition === undefined))
            throw new Error(`application-state ${dimension.key} has incomplete state transition on ${stableIdentity(node)}`);
        return key === undefined ? undefined : { key, transition };
    };
    const recordState = (map: Map<string, StateTransition>, identity: string | undefined,
        projected: StateTransition | undefined): void => {
        if (!identity || !projected) return;
        const prior = map.get(identity);
        if (prior && (prior.key !== projected.key || prior.transition !== projected.transition))
            throw new Error(`application-state ${dimension.key} has conflicting state transitions on ${identity}`);
        map.set(identity, projected);
    };
    const recordPayload = (map: Map<string, string>, identity: string | undefined,
        payload: string | undefined): void => {
        if (!identity || payload === undefined) return;
        const prior = map.get(identity);
        if (prior !== undefined && prior !== payload)
            throw new Error(`application-state ${dimension.key} has conflicting action payloads on ${identity}`);
        map.set(identity, payload);
    };
    const collect = (node: IRNode) => {
        const action = actionBinding(node);
        if (action) {
            const identity = stableIdentity(node);
            const projectedState = stateTransition(node);
            const attributes = (node as any).attributes;
            const projectedPayload = node.interaction?.payloadContract ?? attributes?.pulpPayloadContract;
            const prior = bindings.get(identity);
            if (prior && prior !== action)
                throw new Error(`application-state ${dimension.key} has conflicting actions ${prior} and ${action} on ${identity}`);
            bindings.set(identity, action);
            recordState(stateBindings, identity, projectedState);
            recordPayload(payloadBindings, identity, projectedPayload);
            if (!defaultIdentities.has(identity)) {
                const authoredIdentity = authoredActionIdentity(node);
                const authoredPrior = authoredIdentity ? authoredBindings.get(authoredIdentity) : undefined;
                if (authoredIdentity && authoredPrior && authoredPrior !== action)
                    throw new Error(`application-state ${dimension.key} has conflicting actions ${authoredPrior} and ${action} on ${authoredIdentity}`);
                if (authoredIdentity) authoredBindings.set(authoredIdentity, action);
                recordState(authoredStateBindings, authoredIdentity, projectedState);
                recordPayload(authoredPayloadBindings, authoredIdentity, projectedPayload);
                const contentIdentity = actionContentFingerprint(node);
                const contentPrior = contentIdentity ? contentBindings.get(contentIdentity) : undefined;
                if (contentIdentity && contentPrior && contentPrior !== action)
                    throw new Error(`application-state ${dimension.key} has conflicting actions ${contentPrior} and ${action} on ${contentIdentity}`);
                if (contentIdentity) contentBindings.set(contentIdentity, action);
                recordState(contentStateBindings, contentIdentity, projectedState);
                recordPayload(contentPayloadBindings, contentIdentity, projectedPayload);
            }
        }
        node.children.forEach(collect);
    };
    collect(dimension.root);
    const apply = (node: IRNode) => {
        const identity = stableIdentity(node);
        const authoredIdentity = authoredActionIdentity(node);
        const contentIdentity = actionContentFingerprint(node);
        const action = bindings.get(identity)
            ?? (authoredIdentity ? authoredBindings.get(authoredIdentity) : undefined)
            ?? (contentIdentity ? contentBindings.get(contentIdentity) : undefined);
        const projectedState = stateBindings.get(identity)
            ?? (authoredIdentity ? authoredStateBindings.get(authoredIdentity) : undefined)
            ?? (contentIdentity ? contentStateBindings.get(contentIdentity) : undefined);
        const projectedPayload = payloadBindings.get(identity)
            ?? (authoredIdentity ? authoredPayloadBindings.get(authoredIdentity) : undefined)
            ?? (contentIdentity ? contentPayloadBindings.get(contentIdentity) : undefined);
        if (action) {
            const prior = actionBinding(node);
            if (prior && prior !== action)
                throw new Error(`application-state ${dimension.key} action ${action} conflicts with ${prior} on ${stableIdentity(node)}`);
            if ((node as any).attributes) {
                (node as any).attributes.pulpHostAction = action;
                (node as any).attributes.pulpRouteId ??= nativeRouteIdentity(node);
                if (projectedPayload !== undefined)
                    (node as any).attributes.pulpPayloadContract = projectedPayload;
                if (projectedState) {
                    (node as any).attributes.pulpStateKey = projectedState.key;
                    (node as any).attributes.pulpStateTransition = projectedState.transition;
                }
            }
            else {
                node.interaction = node.interaction
                    ? { ...node.interaction, actionBindingId: action,
                        ...(projectedPayload === undefined ? {} : { payloadContract: projectedPayload }) }
                    : {
                        actionBindingId: action,
                        event: 'click',
                        required: true,
                        disabled: false,
                        focusable: true,
                        ...(projectedPayload === undefined ? {} : { payloadContract: projectedPayload }),
                    };
                if (projectedState) {
                    (node as any).meta = { ...((node as any).meta ?? {}),
                        imported_state_key: projectedState.key,
                        imported_state_transition: projectedState.transition };
                }
            }
        }
        node.children.forEach(apply);
    };
    apply(root);
}

interface VariantGroup {
    target: string; parent: string; targetShape: string; parentShape: string;
    targetLocalSemantic: string; targetInstanceOrdinal: number;
    targetFingerprint?: string; parentFingerprint?: string;
    targetContentFingerprint?: string; parentContentFingerprint?: string;
    targetRect?: { x?: number; y?: number; width?: number; height?: number };
    targetShapeOrdinal: number; index: number; nodes: IRNode[];
}

const cloneProtectedStateBranch = (node: IRNode): IRNode => {
    const branch = clone(node);
    const viewport = rawSource(branch)?.node?.rect;
    if (!viewport) return branch;
    const coversViewport = (candidate: IRNode): boolean => {
        const raw = rawSource(candidate);
        const rect = raw?.node?.rect;
        const style = String(raw?.node?.attributes?.style ?? '');
        return raw?.computedStyle?.position === 'fixed'
            && /(?:^|;)\s*(?:-webkit-)?app-region\s*:\s*drag(?:\s*;|$)/i.test(style)
            && rect !== undefined
            && ['x', 'y', 'width', 'height'].every((field) =>
                Math.abs(Number(rect[field]) - Number(viewport[field])) <= 0.5)
            && actionIds(candidate).size === 0;
    };
    const strip = (parent: IRNode): void => {
        parent.children = parent.children.filter((child) => !coversViewport(child));
        parent.children.forEach(strip);
    };
    strip(branch);
    return branch;
};

function groupsFor(dimension: ProtectedApplicationStateDimension): VariantGroup[] {
    const groups = new Map<string, VariantGroup>();
    const parentsByTarget = new Map<string, string>();
    const visit = (node: IRNode, parent: IRNode | undefined, index: number) => {
        const isVariant = node.responsive?.applicationStateKey === dimension.key;
        if (isVariant) {
            if (!parent) throw new Error(`application-state dimension ${dimension.key} replaces the stable host root`);
            const target = stableIdentity(node), parentId = stableIdentity(parent);
            const stateValue = Object.entries(node.responsive?.visibilityByApplicationState ?? {})
                .find(([, visible]) => visible === true)?.[0];
            if (!stateValue)
                throw new Error(`application-state ${dimension.key} variant has no visible state value`);
            const targetInstanceOrdinal = parent.children.slice(0, index).reduce((count, sibling) => {
                const siblingValue = Object.entries(sibling.responsive?.visibilityByApplicationState ?? {})
                    .find(([, visible]) => visible === true)?.[0];
                return count + (stableIdentity(sibling) === target && siblingValue === stateValue ? 1 : 0);
            }, 0);
            const targetInstance = `${target}\0state-instance:${targetInstanceOrdinal}`;
            const knownParent = parentsByTarget.get(targetInstance);
            if (knownParent && knownParent !== parentId)
                throw new Error(`application-state target ${target} is ambiguously reparented`);
            parentsByTarget.set(targetInstance, parentId);
            const groupKey = `${parentId}\0${targetInstance}`;
            const group: VariantGroup = groups.get(groupKey) ?? {
                target, parent: parentId,
                targetLocalSemantic: localGeneratedSemanticIdentity(node), targetInstanceOrdinal,
                targetShape: shapeIdentity(node), parentShape: shapeIdentity(parent),
                targetFingerprint: semanticFingerprint(node), parentFingerprint: semanticFingerprint(parent),
                targetContentFingerprint: actionContentFingerprint(node),
                parentContentFingerprint: actionContentFingerprint(parent),
                targetRect: rawSource(node)?.node?.rect,
                targetShapeOrdinal: parent.children.slice(0, index)
                    .filter((child) => shapeIdentity(child) === shapeIdentity(node)).length,
                index, nodes: [],
            };
            group.index = Math.min(group.index, index);
            group.nodes.push(cloneProtectedStateBranch(node));
            groups.set(groupKey, group);
            // A state-only branch owns its complete subtree. Re-grafting every
            // annotated descendant independently makes ephemeral portal ids
            // look like unrelated structural replacements and can discard an
            // action carried by an ancestor. Other dimensions still discover
            // nested state branches during their own traversal.
            return;
        }
        node.children.forEach((child, childIndex) => visit(child, node, childIndex));
    };
    visit(dimension.root, undefined, 0);
    for (const group of groups.values()) {
        const portalShell = observedAttributesForIdentity(group.nodes[0] ?? ({} as IRNode))['data-base-ui-portal'] !== undefined;
        const invariantPortal = portalShell && group.nodes.length > 1
            && new Set(group.nodes.map(generatedSemanticIdentity)).size === 1;
        if (invariantPortal) {
            // A portal subtree repeated byte-for-byte across every captured
            // state belongs to another concurrently mounted overlay. Retain
            // the empty state carrier so transitions keep their domain, but
            // do not graft unrelated overlay content into this dimension.
            for (const node of group.nodes) node.children = [];
        }
    }
    if (groups.size === 0) throw new Error(`application-state dimension ${dimension.key} has no protected variants`);
    return [...groups.values()];
}

interface StateNode { value: string; node: IRNode }

const stateNodes = (dimension: ProtectedApplicationStateDimension, nodes: readonly IRNode[]): StateNode[] =>
    nodes.map((node) => {
        const value = Object.entries(node.responsive?.visibilityByApplicationState ?? {})
            .find(([, visible]) => visible === true)?.[0];
        if (!value) throw new Error(`application-state ${dimension.key} variant has no visible state value`);
        return { value, node };
    });

const implicitBase = (space: string, field: string): unknown => {
    if (space === 'layout') {
        if (['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
            'flexBasis', 'top', 'right', 'bottom', 'left'].includes(field)) return 'auto';
        if (['marginTop', 'marginRight', 'marginBottom', 'marginLeft',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'rowGap', 'columnGap', 'gap', 'flexGrow'].includes(field)) return 0;
        if (field === 'flexShrink') return 1;
        if (field === 'display') return 'flex';
        if (field === 'position') return 'static';
        if (field === 'flexDirection') return 'row';
        if (field === 'flexWrap') return 'nowrap';
        if (field === 'alignItems') return 'stretch';
        if (field === 'alignSelf') return 'auto';
        if (field === 'justifyContent') return 'flex-start';
        if (field === 'overflowX' || field === 'overflowY') return 'visible';
    }
    if ((space === 'paint' || space === 'style') && field === 'opacity') return 1;
    if ((space === 'paint' || space === 'style') && ['borderWidth', 'borderRadius'].includes(field)) return 0;
    if ((space === 'paint' || space === 'style') && ['backgroundColor', 'borderColor'].includes(field)) return 'none';
    return undefined;
};

const nodeKind = (node: IRNode): string => node.tag ?? (node as any).type ?? 'node';
const siblingIdentity = (siblings: readonly IRNode[], index: number): string => {
    const identity = stableIdentity(siblings[index]!);
    const matches = siblings.reduce((count, sibling) => count + (stableIdentity(sibling) === identity ? 1 : 0), 0);
    if (matches === 1) return identity;
    const semantic = localGeneratedSemanticIdentity(siblings[index]!);
    const occurrence = siblings.slice(0, index)
        .reduce((count, sibling) => count + (stableIdentity(sibling) === identity
            && localGeneratedSemanticIdentity(sibling) === semantic ? 1 : 0), 0);
    return `${identity}\0semantic:${compactIdentityHash(semantic)}\0occurrence:${occurrence}`;
};
const shapeIdentity = (node: IRNode): string => stableIdentity(node)
    .replace(/-shape-[^/:]+:\d+/g, '-shape:*');
const rawSourceCache = new WeakMap<IRNode, any>();
const rawSource = (node: IRNode): any => {
    if (rawSourceCache.has(node)) return rawSourceCache.get(node);
    let raw: any;
    try {
        const source = (node as any).raw_source;
        raw = typeof source === 'string' ? JSON.parse(source) : source;
    } catch { raw = undefined; }
    rawSourceCache.set(node, raw);
    return raw;
};
const semanticFingerprintCache = new WeakMap<IRNode, string | undefined>();
const semanticFingerprint = (node: IRNode): string | undefined => {
    if (semanticFingerprintCache.has(node)) return semanticFingerprintCache.get(node);
    const raw = rawSource(node);
    const attributes = raw?.node?.attributes ?? {};
    const stableAttributes = ['id', 'class', 'data-slot', 'data-testid', 'role', 'aria-label']
        .filter((key) => typeof attributes[key] === 'string' && attributes[key].trim())
        .map((key) => `${key}=${attributes[key]}`).join('|');
    const result = stableAttributes ? `${nodeKind(node)}|${stableAttributes}` : undefined;
    semanticFingerprintCache.set(node, result);
    return result;
};
const authoredFluidLayout = (node: IRNode, field: string): boolean => {
    const classes = String(rawSource(node)?.node?.attributes?.class ?? '').split(/\s+/);
    if (field === 'width' && classes.some((name) => name === 'w-full' || name === 'w-screen' || name === 'flex-1' || name === 'grow'))
        return true;
    if (field === 'height' && classes.some((name) => name === 'h-full' || name === 'h-screen' || name === 'flex-1' || name === 'grow'))
        return true;
    if ((field === 'marginLeft' || field === 'marginRight') && classes.includes('mx-auto')) return true;
    if ((field === 'marginTop' || field === 'marginBottom') && classes.includes('my-auto')) return true;
    const kebab = field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const winner = rawSource(node)?.node?.styleProvenanceWinners?.[kebab];
    const value = typeof winner === 'string' ? winner : winner?.value;
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === 'auto' || normalized.includes('%')
        || ['fit-content', 'min-content', 'max-content', 'stretch'].includes(normalized);
};
const scopeKey = (when: readonly { key: string; value: string }[] | undefined): string =>
    JSON.stringify([...(when ?? [])].sort((a, b) => a.key.localeCompare(b.key)));

function orderedDimensions(dimensions: readonly ProtectedApplicationStateDimension[]): ProtectedApplicationStateDimension[] {
    const remaining = [...dimensions];
    const result: ProtectedApplicationStateDimension[] = [];
    const keys = new Set(dimensions.map(({ key }) => key));
    while (remaining.length) {
        const ready = remaining.map((dimension, index) => ({ dimension, index }))
            .filter(({ dimension }) => (dimension.when ?? [])
                .every((predicate) => !keys.has(predicate.key) || result.some(({ key }) => key === predicate.key)))
            .sort((left, right) => {
                const presence = (dimension: ProtectedApplicationStateDimension): boolean => {
                    const values = new Set(groupsFor(dimension).flatMap((group) => group.nodes.flatMap((node) =>
                        Object.keys(node.responsive?.visibilityByApplicationState ?? {}))));
                    return values.has('closed') && values.has('open');
                };
                return Number(presence(right.dimension)) - Number(presence(left.dimension))
                    || left.dimension.key.localeCompare(right.dimension.key);
            })[0];
        if (!ready) throw new Error('application-state applicability predicates contain a dependency cycle');
        result.push(remaining.splice(ready.index, 1)[0]!);
    }
    return result;
}

function contextMatches(context: ReadonlyMap<string, string>, when: readonly { key: string; value: string }[] | undefined): boolean {
    return (when ?? []).every((predicate) => context.get(predicate.key) === predicate.value);
}

function contextCompatible(context: ReadonlyMap<string, string>, when: readonly { key: string; value: string }[] | undefined): boolean {
    return (when ?? []).every((predicate) => !context.has(predicate.key) || context.get(predicate.key) === predicate.value);
}

function childContext(parent: ReadonlyMap<string, string>, node: IRNode): Map<string, string> {
    const result = new Map(parent);
    for (const predicate of node.responsive?.applicationStateWhen ?? []) result.set(predicate.key, predicate.value);
    const key = node.responsive?.applicationStateKey;
    const visible = Object.entries(node.responsive?.visibilityByApplicationState ?? {})
        .filter(([, value]) => value === true).map(([value]) => value);
    if (key && visible.length === 1) result.set(key, visible[0]!);
    return result;
}

function clearOwnStateWrapper(node: IRNode, key: string): void {
    if (node.responsive?.applicationStateKey !== key) return;
    delete node.responsive.applicationStateKey;
    delete node.responsive.visibilityByApplicationState;
}

function clearDescendantStateWrappers(node: IRNode, key: string): void {
    for (const child of node.children) {
        clearOwnStateWrapper(child, key);
        clearDescendantStateWrappers(child, key);
    }
}

function applyPropertyVariants(
    target: IRNode,
    dimension: ProtectedApplicationStateDimension,
    variants: readonly StateNode[],
    owners: Map<string, string>,
): void {
    const targetAny = target as any;
    const supportedLayout = new Set(['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
        'flexGrow', 'flexShrink', 'flexBasis',
        'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'gap', 'rowGap', 'columnGap', 'top', 'right', 'bottom', 'left', 'overflowX', 'overflowY']);
    const supportedVisual = new Set(['backgroundColor', 'borderColor', 'opacity', 'borderWidth', 'borderRadius']);
    const authoredStateSelectorEvidence = (node: IRNode, field: string): boolean => {
        const classNames = String(rawSource(node)?.node?.attributes?.class ?? '').split(/\s+/);
        const utilityPrefixes: Record<string, readonly string[]> = {
            width: ['w-'], height: ['h-'], minWidth: ['min-w-'], minHeight: ['min-h-'],
            maxWidth: ['max-w-'], maxHeight: ['max-h-'],
            paddingTop: ['pt-'], paddingRight: ['pr-'], paddingBottom: ['pb-'], paddingLeft: ['pl-'],
            marginTop: ['mt-'], marginRight: ['mr-'], marginBottom: ['mb-'], marginLeft: ['ml-'],
            gap: ['gap-'], rowGap: ['gap-y-'], columnGap: ['gap-x-'],
            flexGrow: ['grow', 'grow-'], flexShrink: ['shrink', 'shrink-'], flexBasis: ['basis-'],
            top: ['top-'], right: ['right-'], bottom: ['bottom-'], left: ['left-'],
            overflowX: ['overflow-x-'], overflowY: ['overflow-y-'], opacity: ['opacity-'],
            backgroundColor: ['bg-'], borderColor: ['border-'], borderWidth: ['border', 'border-'],
            borderRadius: ['rounded', 'rounded-'],
        };
        const prefixes = utilityPrefixes[field] ?? [];
        return classNames.some((name) => {
            const authoredSelector = /^(?:group|peer)-(?:data|aria|has)-.+:/.test(name)
                || /^(?:data|aria|has|open|checked|disabled|enabled|selected)-.+:/.test(name)
                || /^\[(?:data|aria|open|checked|disabled|enabled|selected|&[^\]]*(?:data|aria|open|checked|disabled|enabled|selected))[^\]]*\]:/.test(name);
            if (!authoredSelector) return false;
            const utility = name.slice(name.lastIndexOf(':') + 1);
            return prefixes.some((prefix) => utility === prefix || utility.startsWith(prefix));
        });
    };
    const ownStateEvidence = (field: string): boolean => {
        if (variants.every(({ node }) => rawSource(node) === undefined)) return true;
        const kebab = field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        const winners = new Set(variants.map(({ node }) => {
            const winner = rawSource(node)?.node?.styleProvenanceWinners?.[kebab];
            return JSON.stringify(typeof winner === 'string' ? winner : winner?.value ?? null);
        }));
        if (winners.size > 1) return true;
        const attributes = new Set(variants.map(({ node }) => {
            const source = rawSource(node)?.node?.attributes ?? {};
            return JSON.stringify(Object.fromEntries(['class', 'style', 'data-state', 'data-open',
                'aria-expanded', 'aria-selected', 'hidden'].filter((key) => source[key] !== undefined)
                .map((key) => [key, source[key]])));
        }));
        return attributes.size > 1 || variants.some(({ node }) => authoredStateSelectorEvidence(node, field));
    };
    const varyingFields = (space: 'layout' | 'paint' | 'style') => {
        const fields = new Set(variants.flatMap(({ node }) => Object.keys((node as any)[space] ?? {})));
        return [...fields].filter((field) => (space === 'layout' ? supportedLayout : supportedVisual).has(field)
            && ownStateEvidence(field)
            && !(space === 'layout' && targetAny.layout?.[field] === 'auto')
            && !(space === 'layout' && authoredFluidLayout(target, field))
            && !(space === 'layout' && ['width', 'height'].includes(field)
                && Number(targetAny.layout?.flexGrow ?? 0) > 0)
            && new Set(variants.map(({ node }) =>
            JSON.stringify((node as any)[space]?.[field] ?? implicitBase(space, field)))).size > 1);
    };
    const varying = { layout: varyingFields('layout'), paint: varyingFields('paint'), style: varyingFields('style') };
    const displayVaries = new Set(variants.map(({ node }) => (node as any).layout?.display ?? 'flex')).size > 1;
    if (!displayVaries && !Object.values(varying).some((fields) => fields.length)) return;
    const responsive = target.responsive ?? { visibility: [], layoutVariants: [], sampledViewports: [] };
    responsive.applicationStateBase ??= {};
    responsive.applicationStateVariants ??= [];
    for (const { value, node } of variants) {
        const patch: any = { key: dimension.key, value };
        if (dimension.when?.length) patch.when = [...dimension.when];
        if (displayVaries) {
            patch.visible = ((node as any).layout?.display ?? 'flex') !== 'none';
            responsive.applicationStateBase.visible = (targetAny.layout?.display ?? 'flex') !== 'none';
            const ownerKey = `${stableIdentity(target)}:visibility`;
            const owner = owners.get(ownerKey);
            if (owner && owner !== dimension.key) {
                const priorValues = responsive.applicationStateVariants
                    .filter((item: any) => item.key === owner && item.visible !== undefined)
                    .map((item: any) => item.visible);
                if (priorValues.some((item: boolean) => item !== patch.visible))
                    throw new Error(`application-state field visibility on ${stableIdentity(target)} conflicts between ${owner} and ${dimension.key}`);
            }
            owners.set(ownerKey, dimension.key);
        }
        for (const space of ['layout', 'paint', 'style'] as const) {
            const fields: Record<string, string> = {};
            for (const field of varying[space]) {
                const next = (node as any)[space]?.[field] ?? implicitBase(space, field);
                const prior = targetAny[space]?.[field] ?? implicitBase(space, field);
                if (JSON.stringify(prior) === JSON.stringify(next)) continue;
                if (!['string', 'number', 'boolean'].includes(typeof next))
                    throw new Error(`application-state ${dimension.key} has unsupported non-scalar ${space}.${field}`);
                if (prior === undefined) throw new Error(`application-state base ${stableIdentity(target)} lacks ${space}.${field}`);
                fields[field] = String(next);
                (responsive.applicationStateBase as any)[space] ??= {};
                (responsive.applicationStateBase as any)[space][field] = String(prior);
                const ownerKey = `${stableIdentity(target)}:${space}.${field}`;
                const owner = owners.get(ownerKey);
                if (owner && owner !== dimension.key) {
                    const priorValues = responsive.applicationStateVariants
                        .filter((item: any) => item.key === owner)
                        .map((item: any) => item[space]?.[field]).filter(Boolean);
                    if (priorValues.some((item: string) => item !== fields[field]))
                        throw new Error(`application-state field ${space}.${field} on ${stableIdentity(target)} conflicts between ${owner} (${[...new Set(priorValues)].join(',')}) and ${dimension.key} (${fields[field]})`);
                }
                owners.set(ownerKey, dimension.key);
            }
            if (Object.keys(fields).length) patch[space] = fields;
        }
        const existingIndex = responsive.applicationStateVariants.findIndex((item: any) =>
            item.key === patch.key && item.value === patch.value);
        if (existingIndex >= 0) {
            const existing = responsive.applicationStateVariants[existingIndex]!;
            if (JSON.stringify(existing) !== JSON.stringify(patch))
                throw new Error(`application-state ${dimension.key}:${value} conflicts with an existing variant on ${stableIdentity(target)}`);
            continue;
        }
        responsive.applicationStateVariants.push(patch);
    }
    target.responsive = responsive;
}

/**
 * Find the smallest shared child frontier. Exact durable identities are the
 * primary correspondence. Positional correspondence is allowed only when all
 * captures and the native target have the same arity and node-kind sequence;
 * anything less would guess through an ambiguous topology change.
 */
function alignedChildren(target: IRNode, variants: readonly StateNode[]): Array<{ target: IRNode; variants: StateNode[] }> {
    const rows: Array<{ target: IRNode; variants: StateNode[] }> = [];
    const used = variants.map(() => new Set<number>());
    for (const [targetIndex, targetChild] of target.children.entries()) {
        const targetIdentity = siblingIdentity(target.children, targetIndex);
        const matches = variants.map(({ node }, stateIndex) => {
            const exact = node.children.map((_, index) => siblingIdentity(node.children, index) === targetIdentity ? index : -1)
                .filter((index) => index >= 0 && !used[stateIndex]!.has(index));
            if (exact.length === 1) return exact[0]!;
            const authored = authoredActionIdentity(targetChild);
            if (!authored) return -1;
            const authoredMatches = node.children.map((child, index) => authoredActionIdentity(child) === authored ? index : -1)
                .filter((index) => index >= 0 && !used[stateIndex]!.has(index));
            return authoredMatches.length === 1 ? authoredMatches[0]! : -1;
        });
        if (matches.every((index) => index >= 0)) {
            matches.forEach((index, stateIndex) => used[stateIndex]!.add(index));
            rows.push({ target: targetChild, variants: variants.map(({ value, node }, stateIndex) =>
                ({ value, node: node.children[matches[stateIndex]!]! })) });
        }
    }
    const unmatchedTargets = target.children.filter((child) => !rows.some((row) => row.target === child));
    const unmatchedByState = variants.map(({ node }, stateIndex) =>
        node.children.filter((_, index) => !used[stateIndex]!.has(index)));
    const positional = unmatchedTargets.length > 0
        && unmatchedByState.every((children) => children.length === unmatchedTargets.length)
        && unmatchedTargets.every((child, index) => unmatchedByState
            .every((children) => nodeKind(children[index]!) === nodeKind(child)
                && (shapeIdentity(children[index]!) === shapeIdentity(child)
                    || (semanticFingerprint(child) !== undefined
                        && semanticFingerprint(children[index]!) === semanticFingerprint(child)))));
    if (positional) unmatchedTargets.forEach((targetChild, index) => rows.push({
        target: targetChild,
        variants: variants.map(({ value }, stateIndex) => ({ value, node: unmatchedByState[stateIndex]![index]! })),
    }));
    return rows;
}

/**
 * Rebase independent protected application-state dimensions onto a fresh native
 * DesignIR root. Nested dimensions are replicated into every owning variant;
 * two dimensions may not own the same target because the runtime state selector
 * on one node is intentionally singular.
 */
export function composeApplicationStateDimensions(
    defaultRoot: IRNode,
    dimensions: readonly ProtectedApplicationStateDimension[],
    budget: ApplicationStateCompositionBudget = {},
): { root: IRNode; report: ApplicationStateCompositionReport } {
    if (dimensions.length === 0) throw new Error('application-state composition requires dimensions');
    if (new Set(dimensions.map(({ key }) => key)).size !== dimensions.length)
        throw new Error('application-state composition keys must be unique');
    const root = clone(defaultRoot);
    const defaultIdentities = new Set<string>();
    const collectDefaultIdentities = (node: IRNode) => {
        defaultIdentities.add(stableIdentity(node));
        node.children.forEach(collectDefaultIdentities);
    };
    collectDefaultIdentities(root);
    const owners = new Map<string, string>();
    const structuralOwners = new Map<string, string>();
    const stateOwnedTargets = new Map<string, Set<string>>();
    const presenceOwnedTargets = new Map<string, Set<string>>();
    const presenceDimensionKeys = new Set<string>();
    for (const candidate of dimensions) for (const group of groupsFor(candidate)) {
        const ownersForTarget = stateOwnedTargets.get(group.target) ?? new Set<string>();
        ownersForTarget.add(candidate.key);
        stateOwnedTargets.set(group.target, ownersForTarget);
        const values = new Set(group.nodes.flatMap((node) =>
            Object.keys(node.responsive?.visibilityByApplicationState ?? {})));
        if (values.has('closed') && values.has('open')) {
            presenceDimensionKeys.add(candidate.key);
            const presenceOwners = presenceOwnedTargets.get(group.target) ?? new Set<string>();
            presenceOwners.add(candidate.key);
            presenceOwnedTargets.set(group.target, presenceOwners);
        }
    }
    for (const dimension of orderedDimensions(dimensions)) {
        projectStableActionBindings(root, dimension, defaultIdentities);
        const allStates = groupsFor(dimension).flatMap((group) => group.nodes.flatMap((node) =>
            Object.keys(node.responsive?.visibilityByApplicationState ?? {})));
        const stateValues = [...new Set(allStates)];
        const isPresenceDimension = stateValues.includes('closed') && stateValues.includes('open');
        for (const group of groupsFor(dimension)) {
            const foreignPresenceOwner = [...(presenceOwnedTargets.get(group.target) ?? [])]
                .some((owner) => owner !== dimension.key);
            if (!isPresenceDimension && !defaultIdentities.has(group.target) && foreignPresenceOwner)
                continue;
            const exactParents: Array<{ node: IRNode; context: Map<string, string> }> = [];
            const fallbackParents: Array<{ node: IRNode; context: Map<string, string> }> = [];
            let parentExistsOnlyInsideForeignStateBranch = false;
            const findParents = (node: IRNode, context = new Map<string, string>(), blocked = false) => {
                const next = childContext(context, node);
                const owner = node.responsive?.applicationStateKey;
                const explicitlyScopedToOwner = owner !== undefined
                    && dimension.when?.some(({ key }) => key === owner) === true;
                const nextBlocked = blocked || (owner !== undefined
                    && owner !== dimension.key && !explicitlyScopedToOwner);
                const isParent = stableIdentity(node) === group.parent
                    || shapeIdentity(node) === group.parentShape
                    || (group.parentFingerprint !== undefined && semanticFingerprint(node) === group.parentFingerprint)
                    || (group.parentContentFingerprint !== undefined
                        && actionContentFingerprint(node) === group.parentContentFingerprint);
                if (nextBlocked && isParent) parentExistsOnlyInsideForeignStateBranch = true;
                if (!nextBlocked && contextCompatible(next, dimension.when)) {
                    if (stableIdentity(node) === group.parent) exactParents.push({ node, context: next });
                    else if (shapeIdentity(node) === group.parentShape ||
                        (group.parentFingerprint !== undefined && semanticFingerprint(node) === group.parentFingerprint) ||
                        (group.parentContentFingerprint !== undefined && actionContentFingerprint(node) === group.parentContentFingerprint))
                        fallbackParents.push({ node, context: next });
                }
                node.children.forEach((child) => findParents(child, next, nextBlocked));
            };
            findParents(root);
            const parents = exactParents.length ? exactParents : fallbackParents;
            if (!exactParents.length && parents.length > 1)
                throw new Error(`application-state parent ${group.parent} has ambiguous shape/semantic fallback for ${dimension.key}`);
            // A state-only branch is an ownership frontier. A later, unscoped
            // dimension may contain stale or concurrently-open descendants of
            // that branch in its whole-tree capture, but that is not evidence
            // that it owns a Cartesian copy. Intentional nesting must be
            // declared through the applicability contract (`when`).
            const parentIsForeignStateOnlyTarget = [...(stateOwnedTargets.get(group.parent) ?? [])]
                .some((owner) => owner !== dimension.key);
            if (parents.length === 0 && (parentExistsOnlyInsideForeignStateBranch || parentIsForeignStateOnlyTarget))
                continue;
            if (parents.length === 0)
                throw new Error(`application-state parent ${group.parent} is absent from applicable fresh default IR for ${dimension.key}`);

            const lower = (target: IRNode, variants: readonly StateNode[], context: ReadonlyMap<string, string>): void => {
                const active = contextMatches(context, dimension.when);
                if (contextCompatible(context, dimension.when))
                    applyPropertyVariants(target, dimension, variants, owners);
                const aligned = alignedChildren(target, variants);
                for (const row of aligned) lower(row.target, row.variants, childContext(context, row.target));

                const alignedTargets = new Set(aligned.map(({ target }) => target));
                const usedByState = variants.map(({ node }, stateIndex) => new Set(aligned
                    .map(({ variants: rowVariants }) => rowVariants[stateIndex]!.node)));
                const remainingTargets = target.children.filter((child) => !alignedTargets.has(child));
                const childGroups = new Map<string, StateNode[]>();
                variants.forEach(({ value, node }, stateIndex) => node.children.forEach((child, childIndex) => {
                    if (usedByState[stateIndex]!.has(child)) return;
                    const identity = siblingIdentity(node.children, childIndex);
                    const list = childGroups.get(identity) ?? [];
                    list.push({ value, node: child });
                    childGroups.set(identity, list);
                }));
                // Absence from every protected state is not evidence that this
                // dimension owns a removal. It is an orthogonal difference
                // between the capture cohort and the fresh canonical tree.
                // A structural frontier therefore enters childGroups only
                // when at least one protected state actually contains it.

                if (!active) return;

                for (const [identity, present] of childGroups) {
                    if (present.length === variants.length) {
                        const existing = remainingTargets.find((child) => {
                            const index = target.children.indexOf(child);
                            return index >= 0 && siblingIdentity(target.children, index) === identity;
                        });
                        // A candidate-only child present in every state is not
                        // part of this dimension's frontier. The fresh native
                        // tree remains authoritative; importing it here would
                        // be an unrelated broad-tree replacement.
                        if (!existing) continue;
                        lower(existing, present, childContext(context, existing));
                        continue;
                    }
                    const structuralKey = `${stableIdentity(target)}\0${identity}\0${scopeKey(dimension.when)}`;
                    const priorOwner = structuralOwners.get(structuralKey);
                    if (priorOwner && priorOwner !== dimension.key
                        && presenceDimensionKeys.has(priorOwner)
                        && !presenceDimensionKeys.has(dimension.key))
                        continue;
                    if (priorOwner && priorOwner !== dimension.key)
                        throw new Error(dimension.when?.length
                            ? `application-state structural frontier ${identity} conflicts between scoped dimensions ${priorOwner} and ${dimension.key} (present ${present.map(({ value }) => value).join(',')}; domain ${stateValues.join(',')}; semantic ${localGeneratedSemanticIdentity(present[0]!.node)})`
                            : `application-state missing applicability context for structural overlap ${identity} between ${priorOwner} and ${dimension.key} (present ${present.map(({ value }) => value).join(',')}; domain ${stateValues.join(',')}; semantic ${localGeneratedSemanticIdentity(present[0]!.node)})`);
                    structuralOwners.set(structuralKey, dimension.key);

                    let branch = remainingTargets.find((child) => {
                        const index = target.children.indexOf(child);
                        return index >= 0 && siblingIdentity(target.children, index) === identity;
                    });
                    const branchExistsInDefault = branch !== undefined && defaultIdentities.has(stableIdentity(branch));
                    if (!branch) {
                        if (!present.length) continue;
                        branch = clone(present[0]!.node);
                        clearOwnStateWrapper(branch, dimension.key);
                        const firstOrder = variants.findIndex(({ node }) => node.children.some((child) => stableIdentity(child) === identity));
                        const insertion = Math.min(Math.max(firstOrder, 0), target.children.length);
                        target.children.splice(insertion, 0, branch);
                    }
                    branch.responsive ??= { visibility: [], layoutVariants: [], sampledViewports: [] };
                    // Native responsive state selection is layered over the
                    // ordinary visibility baseline. Preserve the fresh default
                    // tree as that baseline: an existing child is visible,
                    // while a candidate-only child cloned from another state is
                    // hidden until that state is selected.
                    if (!branchExistsInDefault)
                        branch.responsive.visibility = [{ visible: false, structural: true }];
                    else if (!branch.responsive.visibility.length)
                        branch.responsive.visibility = [{ visible: true, structural: true }];
                    branch.responsive.applicationStateKey = dimension.key;
                    branch.responsive.applicationStateWhen = dimension.when ? [...dimension.when] : [];
                    const presentStates = new Set(present.map(({ value }) => value));
                    branch.responsive.visibilityByApplicationState = Object.fromEntries(
                        stateValues.map((value) => [value, presentStates.has(value)]));
                    clearDescendantStateWrappers(branch, dimension.key);
                    if (present.length > 1) lower(branch, present, childContext(context, branch));
                }
            };

            const variants = stateNodes(dimension, group.nodes);
            const bindStateOnlyBranch = (branch: IRNode, present: readonly StateNode[]): void => {
                branch.responsive ??= { visibility: [], layoutVariants: [], sampledViewports: [] };
                branch.responsive.visibility = [{ visible: false, structural: true }];
                branch.responsive.applicationStateKey = dimension.key;
                branch.responsive.visibilityByApplicationState = Object.fromEntries(
                    stateValues.map((value) => [value, present.some((variant) => variant.value === value)]));
                if (dimension.when?.length)
                    branch.responsive.applicationStateWhen = [...dimension.when];
            };
            for (const { node: parent, context } of parents) {
                const applicableMatch = (child: IRNode) =>
                    contextCompatible(childContext(context, child), dimension.when);
                let exactMatches = parent.children.filter((child) =>
                    applicableMatch(child) && stableIdentity(child) === group.target);
                if (exactMatches.length > 1) {
                    const semanticMatches = exactMatches.filter((child) =>
                        localGeneratedSemanticIdentity(child) === group.targetLocalSemantic);
                    if (semanticMatches.length) exactMatches = semanticMatches;
                }
                if (exactMatches.length > 1 && exactMatches[group.targetInstanceOrdinal])
                    exactMatches = [exactMatches[group.targetInstanceOrdinal]!];
                let fallbackMatches = parent.children.filter((child) => applicableMatch(child) &&
                    (shapeIdentity(child) === group.targetShape ||
                    (group.targetFingerprint !== undefined && semanticFingerprint(child) === group.targetFingerprint) ||
                    (group.targetContentFingerprint !== undefined && actionContentFingerprint(child) === group.targetContentFingerprint)));
                if (fallbackMatches.length > 1 && group.targetContentFingerprint !== undefined) {
                    const contentMatches = fallbackMatches.filter((child) =>
                        actionContentFingerprint(child) === group.targetContentFingerprint);
                    if (contentMatches.length) fallbackMatches = contentMatches;
                }
                if (fallbackMatches.length > 1 && group.targetRect) {
                    const distance = (child: IRNode) => {
                        const rect = rawSource(child)?.node?.rect;
                        if (!rect) return Number.POSITIVE_INFINITY;
                        return ['x', 'y', 'width', 'height'].reduce((sum, key) => {
                            const delta = Number(rect[key] ?? 0) - Number((group.targetRect as any)[key] ?? 0);
                            return sum + delta * delta;
                        }, 0);
                    };
                    const ranked = fallbackMatches.map((child) => ({ child, distance: distance(child) }))
                        .sort((a, b) => a.distance - b.distance);
                    if (ranked.length > 1 && ranked[0]!.distance < ranked[1]!.distance)
                        fallbackMatches = [ranked[0]!.child];
                }
                if (fallbackMatches.length > 1 && fallbackMatches[group.targetShapeOrdinal])
                    fallbackMatches = [fallbackMatches[group.targetShapeOrdinal]!];
                if (fallbackMatches.length > 1 && fallbackMatches.includes(parent.children[group.index]!))
                    fallbackMatches = [parent.children[group.index]!];
                let matches = exactMatches.length ? exactMatches : fallbackMatches;
                // Ephemeral portal IDs may be reused by independent overlay
                // systems. Exact generated identity is therefore a candidate
                // set, not sufficient correspondence on its own.
                if (matches.length > 1 && group.targetContentFingerprint !== undefined) {
                    const contentMatches = matches.filter((child) =>
                        actionContentFingerprint(child) === group.targetContentFingerprint);
                    if (contentMatches.length) matches = contentMatches;
                }
                if (matches.length > 1 && group.targetRect) {
                    const distance = (child: IRNode) => {
                        const rect = rawSource(child)?.node?.rect;
                        if (!rect) return Number.POSITIVE_INFINITY;
                        return ['x', 'y', 'width', 'height'].reduce((sum, key) => {
                            const delta = Number(rect[key] ?? 0) - Number((group.targetRect as any)[key] ?? 0);
                            return sum + delta * delta;
                        }, 0);
                    };
                    const ranked = matches.map((child) => ({ child, distance: distance(child) }))
                        .sort((a, b) => a.distance - b.distance);
                    if (ranked.length > 1 && ranked[0]!.distance < ranked[1]!.distance)
                        matches = [ranked[0]!.child];
                }
                if (matches.length > 1 && matches[group.targetShapeOrdinal])
                    matches = [matches[group.targetShapeOrdinal]!];
                if (matches.length > 1 && matches.includes(parent.children[group.index]!))
                    matches = [parent.children[group.index]!];
                if (!exactMatches.length && matches.length > 1)
                    throw new Error(`application-state target ${group.target} has ambiguous shape/semantic fallback for ${dimension.key} (${matches.length} matches, shape ordinal ${group.targetShapeOrdinal}, child index ${group.index})`);
                if (dimension.preserveWholeTreeBranches) {
                    const ownedBranches = parent.children.filter((child) =>
                        stableIdentity(child) === group.target
                        && child.responsive?.applicationStateKey === dimension.key
                        && scopeKey(child.responsive?.applicationStateWhen) === scopeKey(dimension.when));
                    if (ownedBranches.length) {
                        // A promoted whole-tree cohort is an import ownership
                        // frontier. Recomposition must retain its fresh native
                        // branches instead of treating one as an unowned
                        // default and appending another cohort. Stable actions
                        // and transitions have already been projected above;
                        // retaining the branch also prevents an observed state
                        // recapture from replacing resolved native assets with
                        // deferred remote Electron image references.
                        const ownedByValue = new Map<string, IRNode>();
                        for (const branch of ownedBranches) {
                            const values = Object.entries(branch.responsive?.visibilityByApplicationState ?? {})
                                .filter(([, visible]) => visible).map(([value]) => value);
                            if (values.length !== 1)
                                throw new Error(`whole-tree application-state ${dimension.key} owned branch has ${values.length} visible state values`);
                            if (ownedByValue.has(values[0]!))
                                throw new Error(`whole-tree application-state ${dimension.key} has duplicate owned branch ${values[0]}`);
                            ownedByValue.set(values[0]!, branch);
                        }
                        const variantsByValue = new Map(variants.map((variant) => [variant.value, variant]));
                        for (const value of ownedByValue.keys()) {
                            if (!variantsByValue.has(value))
                                throw new Error(`whole-tree application-state ${dimension.key} protected cohort lacks owned branch ${value}`);
                        }
                        const explicitDefault = dimension.defaultValue;
                        if (explicitDefault !== undefined && !variantsByValue.has(explicitDefault))
                            throw new Error(`whole-tree application-state ${dimension.key} lacks declared default ${explicitDefault}`);
                        const baselineValues = ownedBranches.filter((branch) =>
                            branch.responsive?.visibility[0]?.visible === true).map((branch) =>
                            Object.entries(branch.responsive?.visibilityByApplicationState ?? {})
                                .find(([, visible]) => visible)?.[0]).filter((value): value is string => value !== undefined);
                        if (explicitDefault === undefined && baselineValues.length > 1)
                            throw new Error(`whole-tree application-state ${dimension.key} has multiple visible owned defaults`);
                        const defaultValue = explicitDefault ?? baselineValues[0] ?? variants[0]!.value;
                        let insertion = Math.max(...ownedBranches.map((branch) => parent.children.indexOf(branch))) + 1;
                        for (const { value, node } of variants) {
                            const existing = ownedByValue.get(value);
                            const representedByScopedOwner = parent.children.some((child) =>
                                stableIdentity(child) === group.target
                                && child.responsive?.applicationStateKey !== undefined
                                && child.responsive.applicationStateKey !== dimension.key
                                && child.responsive.applicationStateWhen?.some((predicate) =>
                                    predicate.key === dimension.key && predicate.value === value));
                            if (!existing && representedByScopedOwner) continue;
                            const branch = cloneProtectedStateBranch(existing ?? node);
                            if (existing) refreshProtectedLayout(branch, node);
                            branch.responsive ??= { visibility: [], layoutVariants: [], sampledViewports: [] };
                            branch.responsive.visibility = [{ visible: value === defaultValue, structural: true }];
                            branch.responsive.applicationStateKey = dimension.key;
                            branch.responsive.applicationStateWhen = dimension.when ? [...dimension.when] : [];
                            branch.responsive.visibilityByApplicationState = Object.fromEntries(
                                stateValues.map((state) => [state, state === value]));
                            clearDescendantStateWrappers(branch, dimension.key);
                            if (existing) {
                                const index = parent.children.indexOf(existing);
                                parent.children.splice(index, 1, branch);
                                if (index < insertion) insertion = Math.max(insertion, index + 1);
                            } else {
                                parent.children.splice(insertion++, 0, branch);
                            }
                        }
                        continue;
                    }
                    if (matches.length === 0) {
                        const represented = new Set(variants.map(({ value }) => value));
                        if (represented.size === stateValues.length
                            && stateValues.every((value) => represented.has(value)))
                            continue;
                    }
                    if (matches.length !== 1)
                        throw new Error(`whole-tree application-state target ${group.target} matched ${matches.length} fresh default nodes for ${dimension.key}`);
                    const target = matches[0]!;
                    const targetIdentities = subtreeIdentities(target);
                    const ranked = variants.map((variant, index) => ({ index, variant,
                        overlap: [...subtreeIdentities(variant.node)].filter((identity) => targetIdentities.has(identity)).length,
                    })).sort((a, b) => b.overlap - a.overlap);
                    const explicitDefault = dimension.defaultValue === undefined ? -1
                        : variants.findIndex(({ value }) => value === dimension.defaultValue);
                    if (dimension.defaultValue !== undefined && explicitDefault < 0)
                        throw new Error(`whole-tree application-state ${dimension.key} lacks declared default ${dimension.defaultValue}`);
                    if (explicitDefault < 0 && ranked.length > 1 && ranked[0]!.overlap === ranked[1]!.overlap)
                        throw new Error(`whole-tree application-state ${dimension.key} has no unique fresh-default branch`);
                    const defaultVariant = explicitDefault >= 0 ? explicitDefault : ranked[0]!.index;
                    const insertion = parent.children.indexOf(target);
                    const branches = variants.map(({ value, node }, index) => {
                        const branch = cloneProtectedStateBranch(index === defaultVariant ? target : node);
                        if (index === defaultVariant) refreshProtectedLayout(branch, node);
                        branch.responsive ??= { visibility: [], layoutVariants: [], sampledViewports: [] };
                        branch.responsive.visibility = [{ visible: index === defaultVariant, structural: true }];
                        branch.responsive.applicationStateKey = dimension.key;
                        branch.responsive.applicationStateWhen = dimension.when ? [...dimension.when] : [];
                        branch.responsive.visibilityByApplicationState = Object.fromEntries(
                            stateValues.map((state) => [state, state === value]));
                        clearDescendantStateWrappers(branch, dimension.key);
                        return branch;
                    });
                    parent.children.splice(insertion, 1, ...branches);
                    continue;
                }
                const existingOwnedStateOnlyBranch = matches.length === 1 && variants.length === 1
                    && matches[0]!.responsive?.applicationStateKey === dimension.key
                    && isPresenceDimension;
                if (existingOwnedStateOnlyBranch) {
                    // Recomposition must refresh a previously promoted
                    // state-only portal from the current protected cohort.
                    // Otherwise corrected property lowering (positioning,
                    // fonts, colors, assets) can never replace stale literals
                    // embedded by an older importer run.
                    const insertion = parent.children.indexOf(matches[0]!);
                    const branch = clone(variants[0]!.node);
                    bindStateOnlyBranch(branch, variants);
                    clearDescendantStateWrappers(branch, dimension.key);
                    parent.children.splice(insertion, 1, branch);
                    continue;
                }
                const independentlyOwnedPortal = variants.length === 1 && matches.length === 1
                    && matches[0]!.responsive?.applicationStateKey
                    && matches[0]!.responsive?.applicationStateKey !== dimension.key;
                if (independentlyOwnedPortal) {
                    // Whole-tree captures frequently retain an unrelated open
                    // portal while recording a mode, theme, or route change.
                    // Only a presence-state contract may introduce another
                    // independently owned portal with a reused ephemeral id.
                    // Other intentional nesting must use applicability `when`.
                    if (!isPresenceDimension) continue;
                    // The fresh default tree is authoritative. A candidate-only
                    // portal observed only in the first captured state is
                    // cohort topology, not an alternate-state insertion.
                    if (variants[0]!.value === stateValues[0]) continue;
                    const branch = clone(variants[0]!.node);
                    bindStateOnlyBranch(branch, variants);
                    clearDescendantStateWrappers(branch, dimension.key);
                    parent.children.push(branch);
                    continue;
                }
                if (matches.length === 1) {
                    lower(matches[0]!, variants, childContext(context, matches[0]!));
                    continue;
                }
                if (matches.length > 1)
                    throw new Error(`application-state target ${group.target} is ambiguous in applicable fresh default IR for ${dimension.key}`);
                const representedStates = new Set(variants.map(({ value }) => value));
                if (representedStates.size === stateValues.length
                    && stateValues.every((value) => representedStates.has(value))) {
                    // A candidate-only target present in every protected state
                    // is cohort topology, not evidence that this dimension owns
                    // an insertion. This mirrors the recursive child-frontier
                    // rule above and keeps the fresh native tree authoritative.
                    continue;
                }
                // A true state-only portal has no canonical counterpart. Its
                // complete subtree remains a single visibility-gated frontier.
                if (variants.length !== 1)
                    throw new Error(`application-state target ${group.target} is absent from fresh default IR`);
                if (variants[0]!.value === stateValues[0]) continue;
                const branch = clone(variants[0]!.node);
                bindStateOnlyBranch(branch, variants);
                clearDescendantStateWrappers(branch, dimension.key);
                parent.children.splice(Math.min(group.index, parent.children.length), 0, branch);
            }
        }
    }
    // A later dimension may replace a structurally varying subtree that also
    // contains a stable action projected by an earlier dimension. Re-apply the
    // dimension contracts after all structural composition so ordering cannot
    // silently turn an interactive target back into a static node.
    for (const dimension of dimensions)
        projectStableActionBindings(root, dimension, defaultIdentities);
    const actions = actionIds(root);
    for (const dimension of dimensions) for (const action of dimension.requiredActions ?? [])
        if (!actions.has(action)) throw new Error(`application-state composition lost required action ${action}`);
    const identityCounts = new Map<string, number>();
    const countIdentities = (node: IRNode) => {
        const id = stableIdentity(node); identityCounts.set(id, (identityCounts.get(id) ?? 0) + 1);
        node.children.forEach(countIdentities);
    };
    countIdentities(root);
    const defaultNodes = countNodes(defaultRoot), composedNodes = countNodes(root);
    const nodeGrowthRatio = composedNodes / defaultNodes;
    const maximumIdentityDuplication = Math.max(...identityCounts.values());
    const maxGrowth = budget.maxNodeGrowthRatio ?? 4;
    const maxDuplication = budget.maxIdentityDuplication ?? 8;
    if (nodeGrowthRatio > maxGrowth)
        throw new Error(`application-state node growth ${nodeGrowthRatio.toFixed(3)} exceeds budget ${maxGrowth}`);
    if (maximumIdentityDuplication > maxDuplication)
        throw new Error(`application-state identity duplication ${maximumIdentityDuplication} exceeds budget ${maxDuplication}`);
    // Whole-tree captures can reuse generated portal IDs across independent
    // overlays. Preserve source identity for correspondence and budgeting,
    // then assign unique materialization anchors to cloned state branches so
    // one portal's responsive contract cannot overwrite another's at runtime.
    disambiguateStateBranchAnchors(root);
    return { root, report: { dimensions: orderedDimensions(dimensions).map(({ key }) => key), defaultNodes, composedNodes,
        nodeGrowthRatio, maximumIdentityDuplication } };
}
