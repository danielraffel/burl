import type { IRNode } from './types.js';

export interface ApplicationStatePolicyRule {
    id: string;
    attributes: Record<string, string>;
    applicationState?: { key: string; visibility: Record<string, boolean> };
}

export interface ApplicationStateActionTransitionContract {
    key: string;
    action: string;
    before: string;
    after: string;
}

export interface ApplicationStateActionAttachment {
    action: string;
    key: string;
    matchedNodes: number;
    attachedNodes: number;
    preservedNodes: number;
}

export function attachApplicationStateActionTransitions(
    root: IRNode,
    contracts: readonly ApplicationStateActionTransitionContract[],
): ApplicationStateActionAttachment[] {
    const byAction = new Map<string, ApplicationStateActionTransitionContract[]>();
    for (const contract of contracts) {
        if (!contract.key || !contract.action || !contract.before || !contract.after ||
            contract.before === contract.after)
            throw new Error(`invalid application-state action transition for ${contract.action || '<missing>'}`);
        const grouped = byAction.get(contract.action) ?? [];
        if (grouped.some((prior) => prior.before === contract.before && prior.after === contract.after))
            throw new Error(`duplicate application-state action transition for ${contract.action}`);
        grouped.push(contract);
        byAction.set(contract.action, grouped);
    }
    const reports = new Map([...byAction].map(([action, grouped]) => [action, {
        action, key: grouped[0]!.key, matchedNodes: 0, attachedNodes: 0, preservedNodes: 0,
    }]));
    const transitionFor = (
        action: string,
        payload: string | undefined,
        sourceAttributes: Record<string, unknown> | undefined,
    ): { key: string; transition: string } => {
        const grouped = byAction.get(action)!;
        const key = grouped[0]!.key;
        if (grouped.some((contract) => contract.key !== key))
            throw new Error(`application-state action has conflicting keys: ${action}`);
        const domain = new Set(grouped.flatMap((contract) => [contract.before, contract.after]));
        if (payload && domain.has(payload)) return { key, transition: `set:${payload}` };
        if (grouped.length === 1) {
            // aria-expanded is source-authored behavioral evidence that the
            // same control owns both sides of a disclosure. Capture commonly
            // observes only the directed edge used to reach the alternate
            // frame; preserving that edge as `set` would make the control a
            // no-op whenever the imported default is already its destination.
            // Derive the reverse edge from the standard property rather than
            // from product labels or action-name conventions.
            const expanded = sourceAttributes?.['aria-expanded'];
            if (expanded === true || expanded === false || expanded === 'true' || expanded === 'false')
                return { key, transition: `cycle:${grouped[0]!.before},${grouped[0]!.after}` };
            return { key, transition: `set:${grouped[0]!.after}` };
        }
        const next = new Map<string, string>();
        for (const contract of grouped) {
            if (next.has(contract.before))
                throw new Error(`application-state action has ambiguous transitions: ${action}`);
            next.set(contract.before, contract.after);
        }
        const ordered: string[] = [];
        let value = grouped[0]!.before;
        while (!ordered.includes(value)) {
            ordered.push(value);
            const following = next.get(value);
            if (!following) throw new Error(`application-state action has an incomplete transition cycle: ${action}`);
            value = following;
        }
        if (value !== ordered[0] || ordered.length !== domain.size)
            throw new Error(`application-state action has an incomplete transition cycle: ${action}`);
        return { key, transition: `cycle:${ordered.join(',')}` };
    };
    const transitionCoversContracts = (
        transition: string,
        grouped: readonly ApplicationStateActionTransitionContract[],
    ): boolean => {
        if (transition.startsWith('set:'))
            return grouped.every((contract) => transition === `set:${contract.after}`);
        if (!transition.startsWith('cycle:')) return false;
        const values = transition.slice(6).split(',');
        if (values.length < 2 || values.some((value) => !value)) return false;
        return grouped.every((contract) => {
            const before = values.indexOf(contract.before);
            return before >= 0 && values[(before + 1) % values.length] === contract.after;
        });
    };
    const visit = (node: IRNode) => {
        const attributes = (node as any).attributes as Record<string, string> | undefined;
        const action = node.interaction?.actionBindingId ?? attributes?.pulpHostAction;
        const grouped = action ? byAction.get(action) : undefined;
        if (action && grouped) {
            const report = reports.get(action)!;
            report.matchedNodes++;
            const expected = transitionFor(action,
                node.interaction?.payloadContract ?? attributes?.pulpPayloadContract,
                (node.raw_source as any)?.node?.attributes as Record<string, unknown> | undefined);
            const metaKey = typeof node.meta?.imported_state_key === 'string'
                ? node.meta.imported_state_key : undefined;
            const metaTransition = typeof node.meta?.imported_state_transition === 'string'
                ? node.meta.imported_state_transition : undefined;
            const attributeKey = attributes?.pulpStateKey;
            const attributeTransition = attributes?.pulpStateTransition;
            if (metaKey !== undefined && attributeKey !== undefined &&
                (metaKey !== attributeKey || metaTransition !== attributeTransition))
                throw new Error(`conflicting imported and materialized application-state transition for ${action}`);
            const priorKey = metaKey ?? attributeKey;
            const priorTransition = metaTransition ?? attributeTransition;
            if ((priorKey === undefined) !== (priorTransition === undefined))
                throw new Error(`incomplete imported application-state transition for ${action}`);
            const writeTransition = () => {
                if (attributes) {
                    attributes.pulpStateKey = expected.key;
                    attributes.pulpStateTransition = expected.transition;
                } else {
                    node.meta = { ...(node.meta ?? {}), imported_state_key: expected.key,
                        imported_state_transition: expected.transition };
                }
            };
            if (priorKey !== undefined) {
                if (priorKey !== expected.key)
                    throw new Error(`imported application-state key conflict for ${action}`);
                if (transitionCoversContracts(priorTransition!, grouped)) {
                    report.preservedNodes++;
                } else {
                    writeTransition();
                    report.attachedNodes++;
                }
            } else {
                writeTransition();
                report.attachedNodes++;
            }
        }
        node.children.forEach(visit);
    };
    visit(root);
    for (const report of reports.values())
        if (report.matchedNodes === 0)
            throw new Error(`application-state action transition has no imported node: ${report.action}`);
    return [...reports.values()].sort((left, right) => left.action.localeCompare(right.action));
}

/**
 * Reject action transitions whose value language cannot select the captured
 * application-state variants. This runs before materialization so a routed
 * click can never silently target a different state domain.
 */
export function validateApplicationStatePolicyRules(
    rules: readonly ApplicationStatePolicyRule[],
): void {
    const domains = new Map<string, Set<string>>();
    for (const rule of rules) if (rule.applicationState) {
        const key = rule.applicationState.key;
        const values = new Set(Object.keys(rule.applicationState.visibility));
        if (!key || values.size === 0)
            throw new Error(`binding policy ${rule.id} has an invalid application-state domain`);
        const known = domains.get(key);
        if (known && (known.size !== values.size || [...known].some((value) => !values.has(value))))
            throw new Error(`binding policy has conflicting domains for application state ${key}`);
        domains.set(key, values);
    }

    for (const rule of rules) {
        const key = rule.attributes.pulpStateKey;
        const transition = rule.attributes.pulpStateTransition;
        if (!key && !transition) continue;
        if (!key || !transition)
            throw new Error(`binding policy ${rule.id} has an incomplete application-state transition`);
        const domain = domains.get(key);
        if (!domain) continue;
        if (transition === 'toggle') {
            if (domain.size !== 2 || !domain.has('true') || !domain.has('false'))
                throw new Error(`binding policy ${rule.id} uses boolean toggle for non-boolean state ${key}`);
            continue;
        }
        const values = transition.startsWith('set:') ? [transition.slice(4)]
            : transition.startsWith('cycle:') ? transition.slice(6).split(',') : [];
        if (!values.length || values.some((value) => !value || !domain.has(value)) ||
            (transition.startsWith('cycle:') &&
                (values.length !== domain.size || [...domain].some((value) => !values.includes(value)))))
            throw new Error(`binding policy ${rule.id} transition does not match application-state domain ${key}`);
    }
}
