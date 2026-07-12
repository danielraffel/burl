import type { ObservedDomNode, ObservedInteractionEvidence } from './adapters/observed-dom/lower.js';

export interface ReviewedInteractionRule {
    sourceId: string;
    applicationAction: string;
}

export interface InteractionCandidate {
    sourceId: string;
    tag: string;
    role: string;
    accessibleName: string;
    enabled: boolean;
    evidence: ObservedInteractionEvidence | null;
    review: { status: 'mapped' | 'unmapped'; applicationAction?: string };
}

export interface InteractionCandidateReport {
    version: 1;
    candidates: InteractionCandidate[];
    summary: { total: number; mapped: number; unmapped: number; missingEvidence: number };
}

const interactiveTags = new Set(['button', 'input', 'textarea', 'select', 'a']);
const interactiveRoles = new Set(['button', 'checkbox', 'combobox', 'link', 'menuitem',
    'option', 'radio', 'slider', 'switch', 'tab', 'textbox']);

function sourceText(node: ObservedDomNode): string {
    const own = node.text ?? node.content?.filter((item) => item.kind === 'text')
        .map((item) => item.text).join(' ') ?? '';
    return [own, ...node.children.map(sourceText)].join(' ').replace(/\s+/g, ' ').trim();
}

export function extractInteractionCandidates(
    root: ObservedDomNode,
    reviewed: readonly ReviewedInteractionRule[] = [],
): InteractionCandidateReport {
    const rules = new Map(reviewed.map((rule) => [rule.sourceId, rule.applicationAction]));
    const candidates: InteractionCandidate[] = [];
    const visit = (node: ObservedDomNode) => {
        const tag = node.tagName.toLowerCase();
        const role = node.attributes?.role ?? (tag === 'textarea' || tag === 'input' ? 'textbox' : tag);
        if (interactiveTags.has(tag) || interactiveRoles.has(role)) {
            const applicationAction = rules.get(node.sourceId);
            candidates.push({
                sourceId: node.sourceId,
                tag,
                role,
                accessibleName: node.interactionEvidence?.accessibleName ??
                    node.attributes?.['aria-label'] ?? sourceText(node),
                enabled: node.interactionEvidence?.enabled ??
                    (node.attributes?.disabled === undefined && node.attributes?.['aria-disabled'] !== 'true'),
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
    };
}
