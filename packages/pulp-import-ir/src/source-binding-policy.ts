import type { IRNode } from './types.js';
import { resolveUniqueStableSourceId, stableAuthoredSourceSuffix } from './stable-source-identity.js';
import { validateApplicationStatePolicyRules } from './application-state-contract.js';

export interface SourceBindingPolicyMatch {
    sourceId?: string;
    tagName?: string;
    role?: string;
    accessibleName?: string;
    textExact?: string;
    attribute?: { name: string; present?: boolean; value?: string };
}

export interface SourceBindingPolicyRule {
    id: string;
    match: SourceBindingPolicyMatch;
    attributes: Record<string, string>;
    applicationState?: { key: string; visibility: Record<string, boolean> };
}

export interface SourceBindingPolicy {
    version: 1;
    rules: SourceBindingPolicyRule[];
}

export interface SourceBindingPolicyReceipt {
    id: string;
    matchedNodes: number;
    sourceIds: string[];
}

export interface SourceBindingPolicyOptions {
    /** State-specific imports may contain only a subset; the composed gate checks total coverage. */
    requireAllRules?: boolean;
}

type ObservedSource = {
    sourceId?: string;
    tagName?: string;
    attributes?: Record<string, string>;
    text?: string;
};

function observedSource(node: IRNode): ObservedSource | undefined {
    if (node.raw_source.kind !== 'observed-dom') return undefined;
    return node.raw_source.node as ObservedSource;
}

function subtreeText(node: IRNode): string {
    const source = observedSource(node);
    return [source?.text ?? '', node.text?.text ?? '', ...node.children.map(subtreeText)]
        .join(' ').replace(/\s+/g, ' ').trim();
}

function matches(node: IRNode, text: string, match: SourceBindingPolicyMatch): boolean {
    const source = observedSource(node);
    if (!source) return false;
    if (match.sourceId && source.sourceId !== match.sourceId) return false;
    if (match.tagName && source.tagName !== match.tagName) return false;
    const role = source.attributes?.role ?? (source.tagName === 'button' ? 'button'
        : source.tagName === 'textarea' ? 'textbox' : '');
    if (match.role && role !== match.role) return false;
    if (match.accessibleName && source.attributes?.['aria-label'] !== match.accessibleName) return false;
    if (match.textExact && text !== match.textExact) return false;
    if (match.attribute) {
        const value = source.attributes?.[match.attribute.name];
        if (match.attribute.present && value === undefined) return false;
        if (match.attribute.value !== undefined && value !== match.attribute.value) return false;
    }
    return true;
}

/**
 * Apply reviewed source bindings after any responsive/application-state union.
 * Policies are resolved against authored source identity, so state-only nodes
 * receive the same typed bindings as nodes present in the default capture.
 */
export function applySourceBindingPolicy(
    root: IRNode,
    policy: SourceBindingPolicy,
    options: SourceBindingPolicyOptions = {},
): SourceBindingPolicyReceipt[] {
    if (policy.version !== 1 || !Array.isArray(policy.rules))
        throw new Error('invalid source binding policy');
    validateApplicationStatePolicyRules(policy.rules);
    const nodes: IRNode[] = [];
    const visit = (node: IRNode) => {
        nodes.push(node);
        node.children.forEach(visit);
    };
    visit(root);
    const sourceIds = nodes.map(observedSource).map((source) => source?.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId));
    const requireAllRules = options.requireAllRules ?? true;
    const resolvedRules = policy.rules.flatMap((rule) => {
        if (!rule.match.sourceId) return [rule];
        const suffix = stableAuthoredSourceSuffix(rule.match.sourceId);
        const candidates = sourceIds.filter((sourceId) => stableAuthoredSourceSuffix(sourceId) === suffix);
        if (!sourceIds.includes(rule.match.sourceId) && candidates.length === 0 && !requireAllRules) return [];
        return [{ ...rule, match: { ...rule.match,
            sourceId: resolveUniqueStableSourceId(rule.match.sourceId, sourceIds) } }];
    });
    const receipts = new Map(policy.rules.map((rule) => [rule.id, {
        id: rule.id, matchedNodes: 0, sourceIds: new Set<string>(),
    }]));
    for (const node of nodes) {
        const source = observedSource(node);
        if (!source?.sourceId) continue;
        const text = subtreeText(node);
        for (const rule of resolvedRules) if (matches(node, text, rule.match)) {
            (node as any).attributes = {
                ...((node as any).attributes ?? {}),
                ...rule.attributes,
                pulpBindingPolicyRule: rule.id,
            };
            if (rule.applicationState) node.responsive = {
                visibility: [], layoutVariants: [], sampledViewports: [],
                ...(node.responsive ?? {}),
                applicationStateKey: rule.applicationState.key,
                visibilityByApplicationState: rule.applicationState.visibility,
            };
            const receipt = receipts.get(rule.id)!;
            receipt.matchedNodes++;
            receipt.sourceIds.add(source.sourceId);
        }
    }
    const result = [...receipts.values()].map((receipt) => ({
        id: receipt.id,
        matchedNodes: receipt.matchedNodes,
        sourceIds: [...receipt.sourceIds].sort(),
    }));
    for (const receipt of result) {
        if ((requireAllRules && !receipt.matchedNodes) || receipt.sourceIds.length > 1)
            throw new Error(`binding policy ${receipt.id} matched ${receipt.matchedNodes} nodes across ${receipt.sourceIds.length} source identities; expected one source identity`);
    }
    return result;
}
