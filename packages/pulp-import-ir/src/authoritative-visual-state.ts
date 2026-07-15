import { stableAuthoredSourceSuffix } from './stable-source-identity.js';

/**
 * Native DesignIR shape accepted by the visual-state rebase.  This deliberately
 * stays renderer-independent: import consumers may add metadata, responsive
 * constraints, and application-state branches without changing this contract.
 */
export interface NativeVisualStateNode {
    source_node_id?: string;
    style?: Record<string, unknown>;
    visualSkin?: unknown;
    children?: NativeVisualStateNode[];
    [key: string]: unknown;
}

export interface AuthoritativeVisualStateRebaseReport {
    authoritativeNodeCount: number;
    targetNodeCount: number;
    matchedAuthoritativeNodeCount: number;
    rebasedTargetNodeCount: number;
    unmatchedAuthoritativeSourceIds: string[];
    ambiguousAuthoritativeIdentities: string[];
    changedStyleProperties: number;
    changedVisualSkins: number;
}

export interface AuthoritativeVisualStateRebaseResult<T extends NativeVisualStateNode> {
    root: T;
    report: AuthoritativeVisualStateRebaseReport;
}

// nativeStyle() contains both rendered visual properties and a small set of
// layout projections.  The latter must remain owned by responsive/application
// state composition; everything else is source-observed visual truth.
const LAYOUT_STYLE_PROPERTIES = new Set([
    'position', 'zIndex', 'top', 'right', 'bottom', 'left', 'bottomAuto',
    'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
]);

function documentStableIdentity(sourceId: string): string {
    const authored = stableAuthoredSourceSuffix(sourceId);
    if (authored !== sourceId) return authored;
    // A root/body can precede the first authored id.  The HTML wrapper's shape
    // legitimately changes with environment classes (for example light/dark or
    // transparent/opaque), so it cannot participate in persistent identity.
    return sourceId.replace(/^dom\/(?:html-shape-[^/]+\/)?/, '');
}

function visit(root: NativeVisualStateNode, callback: (node: NativeVisualStateNode) => void): void {
    callback(root);
    for (const child of root.children ?? []) visit(child, callback);
}

function visualStyle(style: Record<string, unknown> | undefined): Record<string, unknown> {
    return Object.fromEntries(Object.entries(style ?? {})
        .filter(([property]) => !LAYOUT_STYLE_PROPERTIES.has(property)));
}

function equal(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Rebase a composed Native DesignIR tree onto an authoritative source visual
 * state without replacing its structure, layout, interactions, or responsive
 * and application-state contracts.
 *
 * One authoritative node may update several target copies created by state
 * composition.  Ambiguous authoritative identities fail closed: choosing one
 * would make the result depend on traversal order rather than source evidence.
 */
export function rebaseAuthoritativeVisualState<T extends NativeVisualStateNode>(
    targetRoot: T,
    authoritativeRoot: NativeVisualStateNode,
): AuthoritativeVisualStateRebaseResult<T> {
    const authoritativeNodes: NativeVisualStateNode[] = [];
    const targetNodes: NativeVisualStateNode[] = [];
    visit(authoritativeRoot, (node) => authoritativeNodes.push(node));
    visit(targetRoot, (node) => targetNodes.push(node));

    const authoritativeByIdentity = new Map<string, NativeVisualStateNode[]>();
    for (const node of authoritativeNodes) {
        if (!node.source_node_id) continue;
        const identity = documentStableIdentity(node.source_node_id);
        authoritativeByIdentity.set(identity,
            [...(authoritativeByIdentity.get(identity) ?? []), node]);
    }
    const ambiguousAuthoritativeIdentities = [...authoritativeByIdentity]
        .filter(([, nodes]) => nodes.length !== 1).map(([identity]) => identity).sort();
    if (ambiguousAuthoritativeIdentities.length) {
        throw new Error(`authoritative visual state has ambiguous stable identities: ${ambiguousAuthoritativeIdentities.join(', ')}`);
    }

    const root = structuredClone(targetRoot);
    const matchedIdentities = new Set<string>();
    let rebasedTargetNodeCount = 0;
    let changedStyleProperties = 0;
    let changedVisualSkins = 0;
    visit(root, (target) => {
        if (!target.source_node_id) return;
        const identity = documentStableIdentity(target.source_node_id);
        const authoritative = authoritativeByIdentity.get(identity)?.[0];
        if (!authoritative) return;
        matchedIdentities.add(identity);
        rebasedTargetNodeCount += 1;

        const priorStyle = target.style ?? {};
        const authoritativeStyle = visualStyle(authoritative.style);
        const nextStyle: Record<string, unknown> = {};
        for (const [property, value] of Object.entries(priorStyle)) {
            if (LAYOUT_STYLE_PROPERTIES.has(property)) nextStyle[property] = value;
            else if (!(property in authoritativeStyle)) changedStyleProperties += 1;
        }
        for (const [property, value] of Object.entries(authoritativeStyle)) {
            if (!equal(priorStyle[property], value)) changedStyleProperties += 1;
            nextStyle[property] = structuredClone(value);
        }
        target.style = nextStyle;

        if ('visualSkin' in authoritative) {
            if (!equal(target.visualSkin, authoritative.visualSkin)) changedVisualSkins += 1;
            target.visualSkin = structuredClone(authoritative.visualSkin);
        }
    });

    const unmatchedAuthoritativeSourceIds = authoritativeNodes
        .filter((node) => node.source_node_id &&
            !matchedIdentities.has(documentStableIdentity(node.source_node_id)))
        .map((node) => node.source_node_id!).sort();
    return {
        root,
        report: {
            authoritativeNodeCount: authoritativeNodes.length,
            targetNodeCount: targetNodes.length,
            matchedAuthoritativeNodeCount: matchedIdentities.size,
            rebasedTargetNodeCount,
            unmatchedAuthoritativeSourceIds,
            ambiguousAuthoritativeIdentities,
            changedStyleProperties,
            changedVisualSkins,
        },
    };
}
