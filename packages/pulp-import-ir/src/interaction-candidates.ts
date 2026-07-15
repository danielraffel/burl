import type { ObservedDomNode, ObservedInteractionEvidence } from './adapters/observed-dom/lower.js';
import {
    resolveSourceBindingPolicyAction,
    sourceBindingPolicyMatchPrecedence,
    type SourceBindingPolicy,
    type SourceBindingPolicyMatch,
} from './source-binding-policy.js';
import { resolveUniqueStableSourceId, stableAuthoredSourceSuffix } from './stable-source-identity.js';

export interface ReviewedInteractionRule {
    sourceId: string;
    applicationAction: string;
    ruleId?: string;
    precedence?: number;
}

export interface InteractionCandidateDiagnostic {
    code: 'reviewed-binding-collision-resolved';
    sourceId: string;
    winningRuleId: string;
    losingRuleId: string;
    winningAction: string;
    losingAction: string;
    resolution: 'more-specific-match';
}

export interface InteractionCandidate {
    sourceId: string;
    tag: string;
    role: string;
    accessibleName: string;
    enabled: boolean;
    modalities: Array<'activate' | 'hover' | 'focus' | 'input'>;
    discoveredBy: Array<'semantic-control' | 'captured-listener' | 'react-event-prop'>;
    evidence: ObservedInteractionEvidence | null;
    review: { status: 'mapped' | 'unmapped'; applicationAction?: string };
}

export interface InteractionCandidateReport {
    version: 1;
    candidates: InteractionCandidate[];
    summary: { total: number; mapped: number; unmapped: number; missingEvidence: number };
    diagnostics?: InteractionCandidateDiagnostic[];
}

export interface InteractionCandidateOptions {
    viewport?: { x: number; y: number; width: number; height: number };
}

const interactiveTags = new Set(['button', 'input', 'textarea', 'select', 'a']);
const interactiveRoles = new Set(['button', 'checkbox', 'combobox', 'link', 'menuitem',
    'option', 'radio', 'slider', 'switch', 'tab', 'textbox']);

type InteractionModality = InteractionCandidate['modalities'][number];

const eventModalities: ReadonlyArray<[InteractionModality, ReadonlySet<string>]> = [
    ['activate', new Set(['auxclick', 'click', 'contextmenu', 'dblclick', 'keydown', 'keyup',
        'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit'])],
    ['hover', new Set(['mouseenter', 'mouseover', 'pointerenter', 'pointerover'])],
    ['focus', new Set(['focus', 'focusin'])],
    ['input', new Set(['beforeinput', 'change', 'input'])],
];

function normalizedReactEvent(propName: string): string | null {
    if (!/^on[A-Z]/.test(propName)) return null;
    return propName.slice(2).replace(/Capture$/, '').toLowerCase();
}

function modalitiesFor(evidence: ObservedInteractionEvidence | undefined): InteractionCandidate['modalities'] {
    const eventTypes = new Set(evidence?.listeners.map((listener) => listener.type.toLowerCase()) ?? []);
    for (const propName of evidence?.react?.propNames ?? []) {
        const event = normalizedReactEvent(propName);
        if (event) eventTypes.add(event);
    }
    const captured = new Set(evidence?.modalities ?? []);
    for (const [modality, events] of eventModalities) {
        if ([...eventTypes].some((event) => events.has(event))) captured.add(modality);
    }
    return [...captured].sort();
}

function sourceText(node: ObservedDomNode): string {
    const own = node.text ?? node.content?.filter((item) => item.kind === 'text')
        .map((item) => item.text).join(' ') ?? '';
    return [own, ...node.children.map(sourceText)].join(' ').replace(/\s+/g, ' ').trim();
}

function observedMatches(node: ObservedDomNode, match: SourceBindingPolicyMatch): boolean {
    if (match.sourceId && node.sourceId !== match.sourceId) return false;
    if (match.tagName && node.tagName !== match.tagName) return false;
    const tag = node.tagName.toLowerCase();
    const role = node.attributes?.role ?? (tag === 'button' ? 'button'
        : tag === 'textarea' || tag === 'input' ? 'textbox' : '');
    if (match.role && role !== match.role) return false;
    if (match.accessibleName && node.attributes?.['aria-label'] !== match.accessibleName) return false;
    if (match.textExact && sourceText(node) !== match.textExact) return false;
    if (match.attribute) {
        const value = node.attributes?.[match.attribute.name];
        if (match.attribute.present && value === undefined) return false;
        if (match.attribute.value !== undefined && value !== match.attribute.value) return false;
    }
    return true;
}

function reviewedRulesFromPolicy(root: ObservedDomNode, policy: SourceBindingPolicy): ReviewedInteractionRule[] {
    if (policy.version !== 1 || !Array.isArray(policy.rules))
        throw new Error('invalid source binding policy');
    resolveSourceBindingPolicyAction(policy, '');
    const nodes: ObservedDomNode[] = [];
    const collect = (node: ObservedDomNode) => {
        nodes.push(node);
        node.children.forEach(collect);
    };
    collect(root);
    const sourceIds = nodes.map((node) => node.sourceId);
    return policy.rules.flatMap((rule) => {
        const applicationAction = rule.attributes.pulpHostAction ?? rule.attributes.action_binding_id;
        if (!applicationAction) return [];
        let match = rule.match;
        if (match.sourceId && !sourceIds.includes(match.sourceId)) {
            const suffix = stableAuthoredSourceSuffix(match.sourceId);
            const candidates = sourceIds.filter((sourceId) => stableAuthoredSourceSuffix(sourceId) === suffix);
            match = { ...match, sourceId: resolveUniqueStableSourceId(match.sourceId, candidates) };
        }
        const matches = nodes.filter((node) => observedMatches(node, match));
        if (matches.length !== 1)
            throw new Error(`reviewed interaction rule ${rule.id} matched ${matches.length} nodes; expected one source identity`);
        return [{
            sourceId: matches[0].sourceId,
            applicationAction,
            ruleId: rule.id,
            precedence: sourceBindingPolicyMatchPrecedence(rule.match),
        }];
    });
}

function resolveReviewedRules(reviewed: readonly ReviewedInteractionRule[]): {
    actions: Map<string, string>;
    diagnostics: InteractionCandidateDiagnostic[];
} {
    const grouped = new Map<string, ReviewedInteractionRule[]>();
    for (const rule of reviewed) grouped.set(rule.sourceId, [...(grouped.get(rule.sourceId) ?? []), rule]);
    const actions = new Map<string, string>();
    const diagnostics: InteractionCandidateDiagnostic[] = [];
    for (const [sourceId, sourceRules] of grouped) {
        const ordered = [...sourceRules].sort((a, b) => (b.precedence ?? 0) - (a.precedence ?? 0) ||
            (a.ruleId ?? '').localeCompare(b.ruleId ?? '') ||
            a.applicationAction.localeCompare(b.applicationAction));
        const winner = ordered[0];
        actions.set(sourceId, winner.applicationAction);
        for (const losing of ordered.slice(1)) {
            if (losing.applicationAction === winner.applicationAction) continue;
            if ((losing.precedence ?? 0) === (winner.precedence ?? 0))
                throw new Error(`reviewed interaction collision on ${sourceId}: equally specific rules ${winner.ruleId ?? '<anonymous>'}=${winner.applicationAction} and ${losing.ruleId ?? '<anonymous>'}=${losing.applicationAction}`);
            diagnostics.push({
                code: 'reviewed-binding-collision-resolved', sourceId,
                winningRuleId: winner.ruleId ?? '<anonymous>',
                losingRuleId: losing.ruleId ?? '<anonymous>',
                winningAction: winner.applicationAction,
                losingAction: losing.applicationAction,
                resolution: 'more-specific-match',
            });
        }
    }
    diagnostics.sort((a, b) => a.sourceId.localeCompare(b.sourceId) ||
        a.losingRuleId.localeCompare(b.losingRuleId));
    return { actions, diagnostics };
}

export function extractInteractionCandidates(
    root: ObservedDomNode,
    reviewed: readonly ReviewedInteractionRule[] | SourceBindingPolicy = [],
    options: InteractionCandidateOptions = {},
): InteractionCandidateReport {
    const resolvedReview = Array.isArray(reviewed)
        ? resolveReviewedRules(reviewed)
        : resolveReviewedRules(reviewedRulesFromPolicy(root, reviewed as SourceBindingPolicy));
    const rules = resolvedReview.actions;
    const candidates: InteractionCandidate[] = [];
    const viewport = options.viewport ?? root.rect;
    const visiblyIntersectsViewport = (node: ObservedDomNode) => node.rect.width > 0 && node.rect.height > 0 &&
        node.rect.x + node.rect.width > viewport.x && node.rect.y + node.rect.height > viewport.y &&
        node.rect.x < viewport.x + viewport.width && node.rect.y < viewport.y + viewport.height &&
        node.computedStyle.display !== 'none' && node.computedStyle.opacity !== '0';
    const visit = (node: ObservedDomNode) => {
        const tag = node.tagName.toLowerCase();
        const role = node.attributes?.role ?? (tag === 'textarea' || tag === 'input' ? 'textbox' : tag);
        const semanticControl = interactiveTags.has(tag) || interactiveRoles.has(role);
        const modalities = modalitiesFor(node.interactionEvidence);
        const listenerBacked = node.interactionEvidence?.listeners.some((listener) =>
            eventModalities.some(([, events]) => events.has(listener.type.toLowerCase()))) ?? false;
        // Browser frameworks install delegated listeners on document/root containers. A raw
        // listener is therefore evidence of an interaction surface only when the element also
        // carries local affordance evidence. React element props are already local evidence.
        const listenerSurface = listenerBacked && (node.attributes?.title !== undefined ||
            node.attributes?.['aria-label'] !== undefined || node.attributes?.tabindex !== undefined ||
            node.computedStyle.cursor === 'pointer');
        const reactBacked = node.interactionEvidence?.react?.propNames.some((propName) => {
            const event = normalizedReactEvent(propName);
            return event !== null && eventModalities.some(([, events]) => events.has(event));
        }) ?? false;
        const capturedSurface = (node.interactionEvidence?.modalities?.length ?? 0) > 0;
        if (visiblyIntersectsViewport(node) &&
            (semanticControl || listenerSurface || reactBacked || capturedSurface)) {
            const applicationAction = rules.get(node.sourceId);
            candidates.push({
                sourceId: node.sourceId,
                tag,
                role,
                accessibleName: node.interactionEvidence?.accessibleName ??
                    node.attributes?.['aria-label'] ?? sourceText(node),
                enabled: node.interactionEvidence?.enabled ??
                    (node.attributes?.disabled === undefined && node.attributes?.['aria-disabled'] !== 'true'),
                modalities,
                discoveredBy: [
                    ...(semanticControl ? ['semantic-control' as const] : []),
                    ...(listenerSurface ? ['captured-listener' as const] : []),
                    ...(reactBacked ? ['react-event-prop' as const] : []),
                ],
                evidence: node.interactionEvidence ?? null,
                review: applicationAction
                    ? { status: 'mapped', applicationAction }
                    : { status: 'unmapped' },
            });
        }
        node.children.forEach(visit);
    };
    visit(root);
    candidates.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const mapped = candidates.filter((item) => item.review.status === 'mapped').length;
    return {
        version: 1,
        candidates,
        summary: {
            total: candidates.length,
            mapped,
            unmapped: candidates.length - mapped,
            missingEvidence: candidates.filter((item) => item.evidence === null).length,
        },
        ...(resolvedReview.diagnostics.length ? { diagnostics: resolvedReview.diagnostics } : {}),
    };
}
