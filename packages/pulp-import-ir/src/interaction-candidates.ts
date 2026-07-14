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
    modalities: Array<'activate' | 'hover' | 'focus' | 'input'>;
    discoveredBy: Array<'semantic-control' | 'captured-listener' | 'react-event-prop'>;
    evidence: ObservedInteractionEvidence | null;
    review: { status: 'mapped' | 'unmapped'; applicationAction?: string };
}

export interface InteractionCandidateReport {
    version: 1;
    candidates: InteractionCandidate[];
    summary: { total: number; mapped: number; unmapped: number; missingEvidence: number };
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

export function extractInteractionCandidates(
    root: ObservedDomNode,
    reviewed: readonly ReviewedInteractionRule[] = [],
    options: InteractionCandidateOptions = {},
): InteractionCandidateReport {
    const rules = new Map(reviewed.map((rule) => [rule.sourceId, rule.applicationAction]));
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
    };
}
