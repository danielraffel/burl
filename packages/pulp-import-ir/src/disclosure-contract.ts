import type { ObservedDomNode } from './adapters/observed-dom/lower.js';
import { unionApplicationStateTrees } from './application-state-variants.js';
import type { IRNode } from './types.js';

export interface ObservedDisclosureActivation {
    targetSourceId: string;
    event: 'click' | 'key';
    stateChanged: boolean;
    navigationChanged?: boolean;
    ipc?: readonly { channel: string; direction: 'send' | 'invoke' }[];
}

export interface ObservedDisclosureClosureEvidence {
    event: 'trigger-toggle';
    closed: boolean;
    ariaExpanded: string | null;
    contentHidden: boolean;
}

export interface ObservedDisclosureContract {
    version: 1;
    stateKey: string;
    triggerSourceId: string;
    triggerNodeSourceId: string;
    contentSourceId: string;
    activationEvent: 'click' | 'key';
    relationshipEvidence: 'aria-controls' | 'captured-slot-transition';
    transition: 'cycle:closed,open';
    states: { closed: 'closed'; open: 'open' };
    trigger: {
        dataSlot: string | null;
        ariaExpandedClosed: 'false';
        ariaExpandedOpen: 'true';
    };
    content: {
        dataSlot: string | null;
        openRect: { x: number; y: number; width: number; height: number };
    };
    gates: {
        localStateTransitionObserved: true;
        triggerContentRelationshipObserved: true;
        openContentVisibleObserved: true;
        reversibleTransitionObserved: boolean;
    };
}

export interface ObservedDisclosureDiagnostic {
    code: 'disclosure-trigger-missing' | 'disclosure-trigger-changed-identity'
        | 'disclosure-forward-state-unproven' | 'disclosure-content-missing'
        | 'disclosure-content-ambiguous' | 'disclosure-trigger-content-unrelated'
        | 'disclosure-content-not-visible' | 'disclosure-nonlocal-effect';
    targetSourceId: string;
    message: string;
}

export interface ObservedDisclosureContractReport {
    version: 1;
    contracts: ObservedDisclosureContract[];
    diagnostics: ObservedDisclosureDiagnostic[];
}

function indexTree(root: ObservedDomNode): {
    byIdentity: Map<string, ObservedDomNode>;
    nodes: ObservedDomNode[];
    parent: Map<ObservedDomNode, ObservedDomNode>;
} {
    const byIdentity = new Map<string, ObservedDomNode>();
    const nodes: ObservedDomNode[] = [];
    const parent = new Map<ObservedDomNode, ObservedDomNode>();
    const visit = (node: ObservedDomNode, runtimeSourceId: string) => {
        nodes.push(node);
        byIdentity.set(node.sourceId, node);
        byIdentity.set(runtimeSourceId, node);
        node.children.forEach((child, index) => {
            parent.set(child, node);
            visit(child, `${runtimeSourceId}/${child.tagName.toLowerCase()}:${index + 1}`);
        });
    };
    visit(root, `${root.tagName.toLowerCase()}:1`);
    return { byIdentity, nodes, parent };
}

function slot(node: ObservedDomNode): string | null {
    return node.attributes?.['data-slot'] ?? null;
}

function slotFamily(value: string | null, suffix: '-trigger' | '-content'): string | null {
    return value?.endsWith(suffix) ? value.slice(0, -suffix.length) : null;
}

function relationship(trigger: ObservedDomNode, content: ObservedDomNode,
                      parent: ReadonlyMap<ObservedDomNode, ObservedDomNode>):
    ObservedDisclosureContract['relationshipEvidence'] | null {
    const contentId = content.attributes?.id;
    const controls = trigger.attributes?.['aria-controls']?.split(/\s+/).filter(Boolean) ?? [];
    if (contentId && controls.includes(contentId)) return 'aria-controls';
    const triggerFamily = slotFamily(slot(trigger), '-trigger');
    const contentFamily = slotFamily(slot(content), '-content');
    if (triggerFamily === null || triggerFamily !== contentFamily) return null;
    const familyHost = (node: ObservedDomNode): ObservedDomNode | null => {
        for (let cursor = parent.get(node); cursor; cursor = parent.get(cursor))
            if (slot(cursor) === triggerFamily) return cursor;
        return null;
    };
    const triggerHost = familyHost(trigger);
    const contentHost = familyHost(content);
    return triggerHost && triggerHost === contentHost ? 'captured-slot-transition' : null;
}

function visibleContent(node: ObservedDomNode): boolean {
    return node.rect.width > 0 && node.rect.height > 0 &&
        node.attributes?.hidden === undefined && node.attributes?.['aria-hidden'] !== 'true';
}

/**
 * Derive local disclosure state only from a captured activation and an atomic
 * closed/open DOM pair. Text and geometry never identify the trigger or its
 * content; geometry is used solely as the final proof that open content is
 * visible. Navigation and IPC effects disqualify the transition as local.
 */
export function extractObservedDisclosureContracts(
    closedRoot: ObservedDomNode,
    openRoot: ObservedDomNode,
    activations: readonly ObservedDisclosureActivation[],
    closures: readonly ObservedDisclosureClosureEvidence[] = [],
): ObservedDisclosureContractReport {
    const closed = indexTree(closedRoot);
    const open = indexTree(openRoot);
    const contracts: ObservedDisclosureContract[] = [];
    const diagnostics: ObservedDisclosureDiagnostic[] = [];

    for (const activation of activations) {
        const closedTrigger = closed.byIdentity.get(activation.targetSourceId);
        if (!closedTrigger) {
            diagnostics.push({ code: 'disclosure-trigger-missing', targetSourceId: activation.targetSourceId,
                message: 'activation target is absent from the closed capture' });
            continue;
        }
        const openTrigger = open.byIdentity.get(closedTrigger.sourceId)
            ?? open.byIdentity.get(activation.targetSourceId);
        if (!openTrigger) {
            diagnostics.push({ code: 'disclosure-trigger-changed-identity', targetSourceId: activation.targetSourceId,
                message: 'activation target does not retain its source identity in the open capture' });
            continue;
        }
        if (activation.navigationChanged || (activation.ipc?.length ?? 0) > 0) {
            diagnostics.push({ code: 'disclosure-nonlocal-effect', targetSourceId: activation.targetSourceId,
                message: 'activation performs navigation or IPC and is not a local disclosure transition' });
            continue;
        }
        if (!activation.stateChanged || closedTrigger.attributes?.['aria-expanded'] !== 'false' ||
            openTrigger.attributes?.['aria-expanded'] !== 'true') {
            diagnostics.push({ code: 'disclosure-forward-state-unproven', targetSourceId: activation.targetSourceId,
                message: 'capture does not prove aria-expanded false to true on the activation target' });
            continue;
        }
        const relatedCandidates = open.nodes.map((content) => ({
            content, relationship: relationship(openTrigger, content, open.parent),
        }))
            .filter((item): item is { content: ObservedDomNode;
                relationship: ObservedDisclosureContract['relationshipEvidence'] } =>
                item.relationship !== null && slot(item.content)?.endsWith('-content') === true);
        const explicit = relatedCandidates.filter((item) => item.relationship === 'aria-controls');
        const related = explicit.length > 0 ? explicit : relatedCandidates;
        if (related.length === 0) {
            const anyContent = open.nodes.some((node) => slot(node)?.endsWith('-content'));
            diagnostics.push({
                code: anyContent ? 'disclosure-trigger-content-unrelated' : 'disclosure-content-missing',
                targetSourceId: activation.targetSourceId,
                message: anyContent ? 'captured disclosure content has no durable relationship to the trigger'
                    : 'open capture contains no disclosure content',
            });
            continue;
        }
        if (related.length !== 1) {
            diagnostics.push({ code: 'disclosure-content-ambiguous', targetSourceId: activation.targetSourceId,
                message: 'multiple disclosure contents match the activation target' });
            continue;
        }
        const { content, relationship: relationshipEvidence } = related[0]!;
        if (!visibleContent(content)) {
            diagnostics.push({ code: 'disclosure-content-not-visible', targetSourceId: activation.targetSourceId,
                message: 'related disclosure content is not visibly open in the open capture' });
            continue;
        }
        const reversible = closures.some((closure) => closure.event === 'trigger-toggle' && closure.closed &&
            closure.ariaExpanded === 'false' && closure.contentHidden);
        contracts.push({
            version: 1,
            stateKey: `source.disclosure:${closedTrigger.sourceId}`,
            triggerSourceId: activation.targetSourceId,
            triggerNodeSourceId: closedTrigger.sourceId,
            contentSourceId: content.sourceId,
            activationEvent: activation.event,
            relationshipEvidence,
            transition: 'cycle:closed,open',
            states: { closed: 'closed', open: 'open' },
            trigger: {
                dataSlot: slot(closedTrigger),
                ariaExpandedClosed: 'false',
                ariaExpandedOpen: 'true',
            },
            content: { dataSlot: slot(content), openRect: { ...content.rect } },
            gates: {
                localStateTransitionObserved: true,
                triggerContentRelationshipObserved: true,
                openContentVisibleObserved: true,
                reversibleTransitionObserved: reversible,
            },
        });
    }
    return { version: 1, contracts, diagnostics };
}

function stateMetadata(contract: ObservedDisclosureContract): Record<string, unknown> {
    return {
        imported_state_key: contract.stateKey,
        imported_state_transition: contract.transition,
        imported_disclosure_content_source_id: contract.contentSourceId,
    };
}

/**
 * Compose captured closed/open trees and install the local transition on every
 * materialized trigger variant. Promotion requires a captured reverse toggle;
 * an inferred one-way state is never made interactive.
 */
export function materializeObservedDisclosureState(
    contract: ObservedDisclosureContract,
    closedRoot: IRNode,
    openRoot: IRNode,
): IRNode {
    if (!contract.gates.reversibleTransitionObserved)
        throw new Error(`disclosure ${contract.triggerNodeSourceId} has no captured reversible transition`);
    const root = unionApplicationStateTrees(contract.stateKey, [
        { state: contract.states.closed, root: closedRoot },
        { state: contract.states.open, root: openRoot },
    ]);
    let triggers = 0;
    const visit = (node: IRNode) => {
        if (node.source_node_id === contract.triggerNodeSourceId) {
            node.meta = { ...(node.meta ?? {}), ...stateMetadata(contract) };
            triggers += 1;
        }
        node.children.forEach(visit);
    };
    visit(root);
    if (triggers === 0)
        throw new Error(`disclosure trigger identity ${contract.triggerNodeSourceId} matched no IR nodes`);
    return root;
}
