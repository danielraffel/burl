import type { IRNode } from './types.js';

export interface ApplicationStateCapture {
    state: string;
    root: IRNode;
}

function rawIdentity(node: IRNode): string {
    return node.source_node_id ?? node.stable_anchor_id;
}

function observedAttributes(node: IRNode): Record<string, string> {
    try {
        const value = (node as any).raw_source;
        const raw = typeof value === 'string' ? JSON.parse(value) : value;
        return raw?.node?.attributes ?? {};
    } catch { return {}; }
}

function generatedSemanticSignature(node: IRNode): string {
    const attributes = observedAttributes(node);
    const stable = ['data-slot', 'role', 'aria-label', 'data-testid']
        .filter((key) => typeof attributes[key] === 'string' && attributes[key].trim())
        .map((key) => `${key}=${attributes[key]}`).join('|');
    const content = [
        typeof (node as any).content === 'string' ? (node as any).content : '',
        typeof (node as any).text === 'string' ? (node as any).text : '',
        typeof (node as any).text?.text === 'string' ? (node as any).text.text : '',
        ...((node as any).textRuns ?? []).map((run: any) => run?.text ?? ''),
    ].join(' ').trim();
    const children = node.children.map(generatedSemanticSignature).join(',');
    return `${node.tag ?? (node as any).type ?? 'node'}[${stable}]<${content}>(${children})`;
}

function hasGeneratedIdentity(value: string): boolean {
    return /-id-_r_[^/:]*:\d+/.test(value) ||
        /\[(?:base-ui-|radix-)?_r_[^\]]+\]:\d+/.test(value);
}

function identity(node: IRNode): string {
    const raw = rawIdentity(node);
    if (!hasGeneratedIdentity(raw)) return raw;
    const normalized = raw
        .replace(/-id-_r_[^/:]*:\d+/g, '-id-generated:0')
        .replace(/(\[(?:base-ui-|radix-)?_r_[^\]]+\]):\d+/g, '$1:0');
    return `${normalized}#${generatedSemanticSignature(node)}`;
}

function comparable(node: IRNode): string {
    const value = {
        tag: node.tag, layout: node.layout, paint: node.paint,
        text: node.text, textRuns: node.textRuns, interaction: node.interaction,
        meta: node.meta,
    };
    const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
        : item && typeof item === 'object'
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
                .map(([name, child]) => [name, stable(child)]))
            : item;
    return JSON.stringify(stable(value));
}

function differingComparableFields(left: IRNode, right: IRNode): string[] {
    const fields = ['tag', 'layout', 'paint', 'text', 'textRuns', 'interaction', 'meta'] as const;
    return fields.filter((field) => JSON.stringify((left as any)[field]) !== JSON.stringify((right as any)[field]));
}

/**
 * Union source-captured structural application states into one native tree.
 * Every alternative is materialized once; Burl's existing application-state
 * runtime selects visibility without reconstructing views after a click.
 */
export function unionApplicationStateTrees(
    key: string,
    captures: readonly ApplicationStateCapture[],
    options: { overlayHostIds?: readonly string[] } = {},
): IRNode {
    if (!key.trim()) throw new Error('application state union requires a key');
    if (captures.length < 2) throw new Error('application state union requires at least two captures');
    if (captures.some((capture) => !capture.state.trim()) ||
        new Set(captures.map((capture) => capture.state)).size !== captures.length)
        throw new Error('application state capture names must be non-empty and unique');

    const parentById = new Map<string, string>();
    for (const capture of captures) {
        const seen = new Set<string>();
        const index = (node: IRNode, parent = '') => {
            const id = identity(node);
            const contextualId = hasGeneratedIdentity(rawIdentity(node)) ? `${parent}\0${id}` : id;
            if (seen.has(contextualId)) throw new Error(`duplicate application state identity ${id} in ${capture.state}`);
            seen.add(contextualId);
            const known = parentById.get(contextualId);
            if (known !== undefined && known !== parent)
                throw new Error(`application state identity ${id} changes parent from ${known} to ${parent}`);
            parentById.set(contextualId, parent);
            node.children.forEach((child) => index(child, contextualId));
        };
        index(capture.root);
    }
    const rootIds = new Set(captures.map((capture) => identity(capture.root)));
    if (rootIds.size !== 1) throw new Error('application state roots do not share durable identity');

    const overlayHosts = new Set(options.overlayHostIds ?? []);
    const visibility = (states: ReadonlySet<string>) => ({
        visibility: [{ visible: true, structural: true }],
        layoutVariants: [], sampledViewports: [],
        applicationStateKey: key,
        visibilityByApplicationState: Object.fromEntries(
            captures.map((capture) => [capture.state, states.has(capture.state)])),
    });
    const cloneForState = (node: IRNode, state: string, root = true): IRNode => ({
        ...node,
        stable_anchor_id: `application-state:${state}::${node.stable_anchor_id}`,
        children: node.children.map((child) => cloneForState(child, state, false)),
        ...(root ? { responsive: { ...(node.responsive ?? {}), ...visibility(new Set([state])) } } : {}),
    });
    const merge = (variants: Array<{ state: string; node: IRNode }>, parent = '', overlayScope = false): IRNode[] => {
        const base = variants[0].node;
        if (variants.length > 1 && variants.some((variant) => comparable(variant.node) !== comparable(base)))
            return variants.map((variant) => cloneForState(variant.node, variant.state));
        const childVariants = new Map<string, Array<{ state: string; node: IRNode }>>();
        for (const variant of variants) for (const child of variant.node.children) {
            const id = identity(child);
            const list = childVariants.get(id) ?? [];
            list.push({ state: variant.state, node: child });
            childVariants.set(id, list);
        }
        const order = [...new Set(variants.flatMap((variant) => variant.node.children.map(identity)))];
        const children = order.flatMap((id) => merge(childVariants.get(id)!, identity(base),
            overlayScope || overlayHosts.has(rawIdentity(base))));
        if (variants.length === captures.length) return [{ ...base, children }];
        if ((base.layout?.position === 'fixed' || base.layout?.position === 'absolute') &&
            !overlayScope && !overlayHosts.has(parent) && !overlayHosts.has(rawIdentity(base)))
            throw new Error(`application state overlay ${identity(base)} has no declared overlay host ${parent}`);
        const present = new Set(variants.map((variant) => variant.state));
        return [{
            ...base,
            children,
            responsive: {
                ...(base.responsive ?? {}),
                ...visibility(present),
            },
        }];
    };
    const roots = merge(captures.map((capture) => ({ state: capture.state, node: capture.root })));
    if (roots.length !== 1) {
        const changed = captures.slice(1).flatMap((capture) =>
            differingComparableFields(captures[0]!.root, capture.root).map((field) => `${capture.state}.${field}`));
        throw new Error(`application state root changes render properties (${changed.join(', ')}) and requires a stable host root`);
    }
    return roots[0];
}
