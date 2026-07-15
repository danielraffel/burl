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
    /** Reviewed equivalences between source-captured and application-contract action IDs. */
    actionAliases?: SourceBindingPolicyActionAlias[];
}

export interface SourceBindingPolicyActionAlias {
    sourceAction: string;
    applicationAction: string;
}

export interface SourceBindingPolicyReceipt {
    id: string;
    matchedNodes: number;
    sourceIds: string[];
    collisions?: SourceBindingPolicyCollision[];
}

export interface SourceBindingPolicyCollision {
    sourceId: string;
    attribute: string;
    winningRuleId: string;
    losingRuleId: string;
    winningValue: string;
    losingValue: string;
    resolution: 'more-specific-match';
}

export interface SourceBindingPolicyOptions {
    /** State-specific imports may contain only a subset; the composed gate checks total coverage. */
    requireAllRules?: boolean;
}

/**
 * Reconcile an action captured from the source with the reviewed application
 * contract. Aliases are exact and one-way: there is deliberately no label,
 * substring, or transitive inference.
 */
export function resolveSourceBindingPolicyAction(
    policy: SourceBindingPolicy,
    sourceAction: string,
    applicationActions?: ReadonlySet<string>,
): string {
    if (policy.version !== 1 || !Array.isArray(policy.rules))
        throw new Error('invalid source binding policy');
    const aliases = policy.actionAliases ?? [];
    const resolved = new Map<string, string>();
    for (const alias of aliases) {
        if (!alias || typeof alias.sourceAction !== 'string' || !alias.sourceAction ||
            typeof alias.applicationAction !== 'string' || !alias.applicationAction)
            throw new Error('invalid source binding policy action alias');
        const previous = resolved.get(alias.sourceAction);
        if (previous && previous !== alias.applicationAction)
            throw new Error(`conflicting source binding policy action aliases for ${alias.sourceAction}: ${previous} and ${alias.applicationAction}`);
        if (alias.sourceAction === alias.applicationAction)
            throw new Error(`redundant source binding policy action alias ${alias.sourceAction}`);
        if (aliases.some((candidate) => candidate.sourceAction === alias.applicationAction))
            throw new Error(`transitive source binding policy action alias is not allowed: ${alias.sourceAction} -> ${alias.applicationAction}`);
        if (applicationActions && !applicationActions.has(alias.applicationAction))
            throw new Error(`source binding policy action alias target is absent from application contract: ${alias.applicationAction}`);
        resolved.set(alias.sourceAction, alias.applicationAction);
    }
    const action = resolved.get(sourceAction) ?? sourceAction;
    if (applicationActions && !applicationActions.has(action))
        throw new Error(`source action is absent from application contract and has no reviewed alias: ${sourceAction}`);
    return action;
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
 * Reviewed rules with an authored source identity outrank rules inferred from
 * semantic names or element shape. The remaining score only makes independent
 * non-conflicting rules deterministic; equal-score conflicts still fail closed.
 */
export function sourceBindingPolicyMatchPrecedence(match: SourceBindingPolicyMatch): number {
    if (match.sourceId) return 1_000;
    return (match.attribute?.value !== undefined ? 100 : match.attribute?.present ? 80 : 0) +
        (match.accessibleName ? 40 : 0) + (match.textExact ? 40 : 0) +
        (match.role ? 10 : 0) + (match.tagName ? 5 : 0);
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
    resolveSourceBindingPolicyAction(policy, '');
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
        collisions: [] as SourceBindingPolicyCollision[],
    }]));
    for (const node of nodes) {
        const source = observedSource(node);
        if (!source?.sourceId) continue;
        const text = subtreeText(node);
        const matched = resolvedRules.filter((rule) => matches(node, text, rule.match))
            .map((rule) => ({ rule, precedence: sourceBindingPolicyMatchPrecedence(rule.match) }))
            .sort((a, b) => b.precedence - a.precedence || a.rule.id.localeCompare(b.rule.id));
        if (!matched.length) continue;
        for (const { rule } of matched) {
            const receipt = receipts.get(rule.id)!;
            receipt.matchedNodes++;
            receipt.sourceIds.add(source.sourceId);
        }
        const resolvedAttributes: Record<string, { value: string; ruleId: string; precedence: number }> = {};
        for (const { rule, precedence } of matched) for (const [attribute, value] of Object.entries(rule.attributes)) {
            const winner = resolvedAttributes[attribute];
            if (!winner) {
                resolvedAttributes[attribute] = { value, ruleId: rule.id, precedence };
                continue;
            }
            if (winner.value === value) continue;
            if (winner.precedence === precedence)
                throw new Error(`binding policy collision on ${source.sourceId} attribute ${attribute}: equally specific rules ${winner.ruleId}=${winner.value} and ${rule.id}=${value}`);
            receipts.get(rule.id)!.collisions.push({
                sourceId: source.sourceId, attribute,
                winningRuleId: winner.ruleId, losingRuleId: rule.id,
                winningValue: winner.value, losingValue: value,
                resolution: 'more-specific-match',
            });
        }
        const attributes = Object.fromEntries(Object.entries(resolvedAttributes)
            .map(([key, resolved]) => [key, resolved.value]));
        (node as any).attributes = {
            ...((node as any).attributes ?? {}),
            ...attributes,
            pulpBindingPolicyRule: matched[0].rule.id,
        };
        const action = attributes.pulpHostAction ?? attributes.action_binding_id;
        if (action) {
            const eventContract = attributes.pulpEventContract ?? 'click';
            const event = eventContract.startsWith('change') ? 'change'
                : eventContract.startsWith('input') ? 'input'
                : eventContract.startsWith('key') ? 'key' : 'click';
            node.interaction = {
                ...(node.interaction ?? {}),
                actionBindingId: action,
                event,
                required: true,
                disabled: attributes.disabled === 'true',
                focusable: attributes.focusable !== 'false',
                ...(attributes.tabIndex === undefined ? {}
                    : { tabIndex: Number(attributes.tabIndex) }),
                ...(attributes.pulpPayloadContract === undefined ? {}
                    : { payloadContract: attributes.pulpPayloadContract }),
            };
        }
        const stateRules = matched.filter(({ rule }) => rule.applicationState);
        if (stateRules.length) {
            const winner = stateRules[0];
            const winnerState = JSON.stringify(winner.rule.applicationState);
            const ambiguous = stateRules.find(({ rule, precedence }) => precedence === winner.precedence &&
                JSON.stringify(rule.applicationState) !== winnerState);
            if (ambiguous)
                throw new Error(`binding policy collision on ${source.sourceId} applicationState: equally specific rules ${winner.rule.id} and ${ambiguous.rule.id}`);
            const applicationState = winner.rule.applicationState!;
            node.responsive = {
                visibility: [], layoutVariants: [], sampledViewports: [],
                ...(node.responsive ?? {}),
                applicationStateKey: applicationState.key,
                visibilityByApplicationState: applicationState.visibility,
            };
        }
    }
    const result = [...receipts.values()].map((receipt) => ({
        id: receipt.id,
        matchedNodes: receipt.matchedNodes,
        sourceIds: [...receipt.sourceIds].sort(),
        ...(receipt.collisions.length ? { collisions: receipt.collisions.sort((a, b) =>
            a.sourceId.localeCompare(b.sourceId) || a.attribute.localeCompare(b.attribute)) } : {}),
    }));
    for (const receipt of result) {
        if ((requireAllRules && !receipt.matchedNodes) || receipt.sourceIds.length > 1)
            throw new Error(`binding policy ${receipt.id} matched ${receipt.matchedNodes} nodes across ${receipt.sourceIds.length} source identities; expected one source identity`);
    }
    return result;
}
