import type { ObservedDomNode } from './adapters/observed-dom/lower.js';

export type ObservedOverlayKind = 'tooltip' | 'popover' | 'menu' | 'dialog';
export type ObservedOverlayActivationEvent = 'hover' | 'click' | 'focus' | 'key' | 'context-menu';
export type ObservedOverlayDismissal = 'escape' | 'outside-pointer' | 'trigger-toggle';

export interface ObservedOverlayActivation {
    targetSourceId: string;
    event: ObservedOverlayActivationEvent;
    /** Authored/source-observed intentional delay, excluding renderer mount latency. */
    openDelayMs?: number;
}

export interface ObservedOverlayDismissalEvidence {
    event: ObservedOverlayDismissal;
    closed: boolean;
    focusRestored?: boolean;
}

export interface ObservedOverlayContract {
    version: 1;
    triggerSourceId: string;
    triggerNodeSourceId: string;
    contentSourceId: string;
    kind: ObservedOverlayKind;
    activationEvent: ObservedOverlayActivationEvent;
    anchor: {
        kind: 'trigger' | 'pointer';
        evidence: 'activation-event';
    };
    timing: {
        openDelayMs: number;
        evidence: 'captured-open-transition';
    };
    relationshipEvidence: 'aria-controls' | 'aria-describedby' | 'captured-slot-transition';
    trigger: {
        dataSlot: string | null;
        accessibleName: string;
        ariaHasPopup: string | null;
        ariaExpandedClosed: string | null;
        ariaExpandedOpen: string | null;
    };
    content: {
        dataSlot: string | null;
        role: string | null;
        side: string | null;
        align: string | null;
        items: Array<{
            sourceId: string;
            role: 'menuitem';
            accessibleName: string;
            actionBindingId: string | null;
        }>;
    };
    gates: {
        openTransitionObserved: true;
        triggerContentRelationshipObserved: true;
        escapeDismissalObserved: boolean;
        outsidePointerDismissalObserved: boolean;
        triggerToggleDismissalObserved: boolean;
        focusRestorationObserved: boolean;
    };
}

const triggerMetadata = (contract: ObservedOverlayContract): Record<string, unknown> => ({
    imported_overlay_kind: contract.kind,
    imported_overlay_activation: contract.activationEvent,
    imported_overlay_anchor: contract.anchor.kind,
    imported_overlay_open_delay_ms: contract.timing.openDelayMs,
    imported_overlay_content_source_id: contract.contentSourceId,
    imported_overlay_side: contract.content.side ?? 'bottom',
    imported_overlay_align: contract.content.align ?? 'center',
    imported_overlay_dismiss_escape: contract.gates.escapeDismissalObserved,
    imported_overlay_dismiss_outside_pointer: contract.gates.outsidePointerDismissalObserved,
    imported_overlay_dismiss_trigger_toggle: contract.gates.triggerToggleDismissalObserved,
    imported_overlay_restore_focus: contract.gates.focusRestorationObserved,
});

const contentMetadata = (contract: ObservedOverlayContract): Record<string, unknown> => ({
    imported_overlay_content: true,
    imported_overlay_trigger_source_id: contract.triggerNodeSourceId,
});

const nativeOverlayAttributes = (metadata: Record<string, unknown>): Record<string, string> => {
    const projected: Record<string, string> = {};
    for (const [metadataKey, attributeKey] of [
        ['imported_overlay_kind', 'pulpOverlayKind'],
        ['imported_overlay_activation', 'pulpOverlayActivation'],
        ['imported_overlay_anchor', 'pulpOverlayAnchor'],
        ['imported_overlay_open_delay_ms', 'pulpOverlayOpenDelayMs'],
        ['imported_overlay_content_source_id', 'pulpOverlayContentSourceId'],
        ['imported_overlay_side', 'pulpOverlaySide'],
        ['imported_overlay_align', 'pulpOverlayAlign'],
        ['imported_overlay_dismiss_escape', 'pulpOverlayDismissEscape'],
        ['imported_overlay_dismiss_outside_pointer', 'pulpOverlayDismissOutsidePointer'],
        ['imported_overlay_dismiss_trigger_toggle', 'pulpOverlayDismissTriggerToggle'],
        ['imported_overlay_restore_focus', 'pulpOverlayRestoreFocus'],
        ['imported_overlay_content', 'pulpOverlayContent'],
        ['imported_overlay_trigger_source_id', 'pulpOverlayTriggerSourceId'],
        ['imported_overlay_host_for', 'pulpOverlayHostFor'],
    ] as const) {
        const value = metadata[metadataKey];
        if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
            projected[attributeKey] = String(value);
    }
    return projected;
};

/**
 * Attach reviewed overlay contracts to a normalized tree using stable source
 * identities. The projection never searches by text or geometry. A missing or
 * ambiguous identity is rejected before native materialization can install an
 * interaction.
 */
export function applyObservedOverlayContracts<T extends { source_node_id?: string;
    children: T[]; meta?: Record<string, unknown>; attributes?: Record<string, string>;
    style?: { opacity?: number; [key: string]: unknown } }>(
    root: T,
    contracts: readonly ObservedOverlayContract[],
): T {
    const projected = structuredClone(root);
    const bySourceId = new Map<string, T[]>();
    const parent = new Map<T, T>();
    const visit = (node: T) => {
        if (node.source_node_id) {
            const matches = bySourceId.get(node.source_node_id) ?? [];
            matches.push(node);
            bySourceId.set(node.source_node_id, matches);
        }
        node.children.forEach((child) => { parent.set(child, node); visit(child); });
    };
    visit(projected);
    const unique = (sourceId: string, role: string): T => {
        const matches = bySourceId.get(sourceId) ?? [];
        if (matches.length !== 1)
            throw new Error(`overlay ${role} identity ${sourceId} matched ${matches.length} nodes`);
        return matches[0]!;
    };
    for (const contract of contracts) {
        const trigger = unique(contract.triggerNodeSourceId, 'trigger');
        const content = unique(contract.contentSourceId, 'content');
        const triggerMeta = triggerMetadata(contract);
        const contentMeta = contentMetadata(contract);
        trigger.meta = { ...(trigger.meta ?? {}), ...triggerMeta };
        trigger.attributes = { ...(trigger.attributes ?? {}),
            ...nativeOverlayAttributes(triggerMeta) };
        content.meta = { ...(content.meta ?? {}), ...contentMeta };
        content.attributes = { ...(content.attributes ?? {}),
            ...nativeOverlayAttributes(contentMeta) };
        // A newly mounted semantic overlay is necessarily visible in its open
        // endpoint. Some source libraries mount at opacity 0 and animate to 1;
        // capture motion guards can freeze that transient start frame even
        // though the atomic PNG records the settled visible endpoint. Repair
        // only this contradictory zero-opacity endpoint. Non-zero authored
        // translucency remains untouched.
        if (content.style && typeof content.style.opacity === 'number'
            && content.style.opacity <= 0) {
            content.style = { ...content.style, opacity: 1 };
            content.meta = { ...(content.meta ?? {}),
                imported_overlay_open_endpoint_repair: 'zero-opacity-transition-start' };
        }
        for (const item of contract.content.items) {
            if (item.actionBindingId === null) continue;
            const itemNode = unique(item.sourceId, 'menu item');
            itemNode.meta = { ...(itemNode.meta ?? {}), action_binding_id: item.actionBindingId };
            itemNode.attributes = { ...(itemNode.attributes ?? {}),
                action_binding_id: item.actionBindingId };
        }
        const triggerAncestors = new Set<T>();
        for (let cursor: T | undefined = trigger; cursor; cursor = parent.get(cursor))
            triggerAncestors.add(cursor);
        for (let cursor: T | undefined = content;
             cursor && !triggerAncestors.has(cursor); cursor = parent.get(cursor)) {
            const hostMeta = { imported_overlay_host_for: contract.triggerNodeSourceId };
            cursor.meta = { ...(cursor.meta ?? {}), ...hostMeta };
            cursor.attributes = { ...(cursor.attributes ?? {}),
                ...nativeOverlayAttributes(hostMeta) };
        }
    }
    return projected;
}

export interface ObservedOverlayDiagnostic {
    code: 'overlay-trigger-missing' | 'overlay-trigger-changed-identity'
        | 'overlay-content-missing' | 'overlay-content-ambiguous'
        | 'overlay-trigger-content-unrelated';
    targetSourceId: string;
    message: string;
}

export interface ObservedOverlayContractReport {
    version: 1;
    contracts: ObservedOverlayContract[];
    diagnostics: ObservedOverlayDiagnostic[];
}

export interface ObservedOverlayContractIdentityRebase {
    triggerNodeSourceId: string;
    capturedContentSourceId: string;
    composedContentSourceId: string;
    dataSlot: string;
    role: string | null;
}

/**
 * Reconcile portal identities after independently captured application-state
 * dimensions have been composed. Exact identities always win. When a portal's
 * runtime-generated id changed between otherwise compatible captures, a
 * contract may be rebound only by a unique captured semantic signature
 * (data-slot plus role). Text and geometry are intentionally excluded.
 */
export function rebaseObservedOverlayContractContentIdentities<T extends {
    source_node_id?: string;
    children: T[];
    attributes?: Record<string, string>;
}>(root: T, contracts: readonly ObservedOverlayContract[]): {
    contracts: ObservedOverlayContract[];
    rebases: ObservedOverlayContractIdentityRebase[];
} {
    const bySourceId = new Map<string, T[]>();
    const nodes: T[] = [];
    const visit = (node: T) => {
        nodes.push(node);
        if (node.source_node_id) {
            const matches = bySourceId.get(node.source_node_id) ?? [];
            matches.push(node);
            bySourceId.set(node.source_node_id, matches);
        }
        node.children.forEach(visit);
    };
    visit(root);
    const rebases: ObservedOverlayContractIdentityRebase[] = [];
    const resolved = contracts.map((contract) => {
        const exact = bySourceId.get(contract.contentSourceId) ?? [];
        if (exact.length === 1) return structuredClone(contract);
        if (exact.length > 1)
            throw new Error(`overlay content identity ${contract.contentSourceId} matched ${exact.length} nodes`);
        const dataSlot = contract.content.dataSlot;
        if (!dataSlot)
            throw new Error(`overlay content identity ${contract.contentSourceId} matched 0 nodes and has no semantic slot`);
        const semantic = nodes.filter((node) => node.attributes?.sourceDataSlot === dataSlot
            && (contract.content.role === null
                || (node.attributes?.role ?? null) === contract.content.role));
        if (semantic.length !== 1)
            throw new Error(`overlay content identity ${contract.contentSourceId} matched 0 nodes; semantic signature ${dataSlot}/${contract.content.role ?? 'none'} matched ${semantic.length} nodes`);
        const composedContentSourceId = semantic[0]!.source_node_id;
        if (!composedContentSourceId)
            throw new Error(`overlay semantic content ${dataSlot}/${contract.content.role ?? 'none'} has no source identity`);
        rebases.push({
            triggerNodeSourceId: contract.triggerNodeSourceId,
            capturedContentSourceId: contract.contentSourceId,
            composedContentSourceId,
            dataSlot,
            role: contract.content.role,
        });
        return { ...structuredClone(contract), contentSourceId: composedContentSourceId };
    });
    return { contracts: resolved, rebases };
}

function authoredIdentitySuffix(sourceId: string): string | null {
    const segments = sourceId.split('/');
    const authoredRoot = segments.findIndex((segment) => /\[[^\]]+\]/.test(segment));
    if (authoredRoot < 0) return null;
    const suffix = segments.slice(authoredRoot);
    suffix[0] = suffix[0]!.replace(/:\d+$/, '');
    return suffix.join('/');
}

function indexTree(root: ObservedDomNode): {
    byIdentity: Map<string, ObservedDomNode>;
    nodes: ObservedDomNode[];
} {
    const byIdentity = new Map<string, ObservedDomNode>();
    const nodes: ObservedDomNode[] = [];
    const visit = (node: ObservedDomNode, runtimeSourceId: string) => {
        nodes.push(node);
        byIdentity.set(node.sourceId, node);
        const stableSuffix = authoredIdentitySuffix(node.sourceId);
        if (stableSuffix) byIdentity.set(stableSuffix, node);
        // Interaction capture runs before stable authored identities are
        // synthesized and therefore records the live element path. Rebuild the
        // same element-only path from the observed tree so the captured target
        // can be joined to its stable node without coordinates or label text.
        byIdentity.set(runtimeSourceId, node);
        node.children.forEach((child, index) =>
            visit(child, `${runtimeSourceId}/${child.tagName.toLowerCase()}:${index + 1}`));
    };
    visit(root, `${root.tagName.toLowerCase()}:1`);
    return { byIdentity, nodes };
}

function slot(node: ObservedDomNode): string | null {
    return node.attributes?.['data-slot'] ?? null;
}

function overlayKind(node: ObservedDomNode): ObservedOverlayKind | null {
    const dataSlot = slot(node);
    if (dataSlot === 'tooltip-content') return 'tooltip';
    if (dataSlot === 'popover-content') return 'popover';
    if (dataSlot === 'menu-content' || dataSlot === 'dropdown-menu-content'
        || dataSlot === 'context-menu-content') return 'menu';
    const role = node.attributes?.role;
    if (role === 'tooltip') return 'tooltip';
    if (role === 'menu') return 'menu';
    if (role === 'dialog') return 'dialog';
    return null;
}

function sourceText(node: ObservedDomNode): string {
    const own = node.interactionEvidence?.accessibleName ?? node.attributes?.['aria-label']
        ?? node.attributes?.title ?? node.text ?? node.content?.filter((item) => item.kind === 'text')
            .map((item) => item.text).join(' ') ?? '';
    return [own, ...node.children.map(sourceText)].join(' ').replace(/\s+/g, ' ').trim();
}

function slotFamily(value: string | null, suffix: '-trigger' | '-content'): string | null {
    return value?.endsWith(suffix) ? value.slice(0, -suffix.length) : null;
}

function explicitRelationship(trigger: ObservedDomNode, content: ObservedDomNode):
    ObservedOverlayContract['relationshipEvidence'] | null {
    const id = content.attributes?.id;
    if (!id) return null;
    const tokens = (value: string | undefined) => value?.split(/\s+/).filter(Boolean) ?? [];
    if (tokens(trigger.attributes?.['aria-controls']).includes(id)) return 'aria-controls';
    if (tokens(trigger.attributes?.['aria-describedby']).includes(id)) return 'aria-describedby';
    return null;
}

function capturedSlotRelationship(trigger: ObservedDomNode, content: ObservedDomNode): boolean {
    const triggerFamily = slotFamily(slot(trigger), '-trigger');
    const contentFamily = slotFamily(slot(content), '-content');
    return triggerFamily !== null && triggerFamily === contentFamily;
}

function menuItems(content: ObservedDomNode): ObservedOverlayContract['content']['items'] {
    const items: ObservedOverlayContract['content']['items'] = [];
    const visit = (node: ObservedDomNode) => {
        if (node.attributes?.role === 'menuitem') {
            items.push({
                sourceId: node.sourceId,
                role: 'menuitem',
                accessibleName: sourceText(node),
                actionBindingId: node.attributes?.['data-pulp-action'] ?? null,
            });
        }
        node.children.forEach(visit);
    };
    content.children.forEach(visit);
    return items;
}

/**
 * Projects source-observed overlay relationships from a closed/open state pair.
 * The function deliberately refuses geometry or text matching. A relationship
 * must be carried by ARIA references or by a captured activation whose trigger
 * and newly-mounted content share the source component's data-slot family.
 */
export function extractObservedOverlayContracts(
    closedRoot: ObservedDomNode,
    openRoot: ObservedDomNode,
    activations: readonly ObservedOverlayActivation[],
    dismissals: readonly ObservedOverlayDismissalEvidence[] = [],
): ObservedOverlayContractReport {
    const closed = indexTree(closedRoot);
    const open = indexTree(openRoot);
    const closedStableIds = new Set(closed.nodes.map((node) => node.sourceId));
    const addedContent = open.nodes.filter((node) =>
        !closedStableIds.has(node.sourceId) && overlayKind(node) !== null);
    const contracts: ObservedOverlayContract[] = [];
    const diagnostics: ObservedOverlayDiagnostic[] = [];

    for (const activation of activations) {
        const targetSuffix = authoredIdentitySuffix(activation.targetSourceId);
        const closedTrigger = closed.byIdentity.get(activation.targetSourceId)
            ?? (targetSuffix ? closed.byIdentity.get(targetSuffix) : undefined);
        if (!closedTrigger) {
            diagnostics.push({ code: 'overlay-trigger-missing', targetSourceId: activation.targetSourceId,
                message: 'activation target is absent from the closed capture' });
            continue;
        }
        // Opening a portal can insert focus sentinels or other infrastructure
        // before the trigger, changing its live sibling-index path. Once the
        // captured target resolves in the closed tree, cross the state boundary
        // with its authored stable identity rather than the volatile live path.
        const openTrigger = open.byIdentity.get(closedTrigger.sourceId)
            ?? open.byIdentity.get(activation.targetSourceId);
        if (!openTrigger) {
            diagnostics.push({ code: 'overlay-trigger-changed-identity', targetSourceId: activation.targetSourceId,
                message: 'activation target does not retain its source identity in the open capture' });
            continue;
        }
        const related = addedContent.map((content) => ({
            content,
            relationship: explicitRelationship(openTrigger, content)
                ?? (capturedSlotRelationship(openTrigger, content) ? 'captured-slot-transition' : null),
        })).filter((item): item is { content: ObservedDomNode;
            relationship: ObservedOverlayContract['relationshipEvidence'] } => item.relationship !== null);
        if (related.length === 0) {
            diagnostics.push({
                code: addedContent.length === 0 ? 'overlay-content-missing' : 'overlay-trigger-content-unrelated',
                targetSourceId: activation.targetSourceId,
                message: addedContent.length === 0
                    ? 'the open capture contains no newly mounted semantic overlay content'
                    : 'new overlay content has no durable source relationship to the activation target',
            });
            continue;
        }
        if (related.length !== 1) {
            diagnostics.push({ code: 'overlay-content-ambiguous', targetSourceId: activation.targetSourceId,
                message: 'multiple newly mounted overlays match the activation target' });
            continue;
        }
        const { content, relationship } = related[0];
        const kind = overlayKind(content)!;
        const observed = (event: ObservedOverlayDismissal) =>
            dismissals.some((item) => item.event === event && item.closed);
        contracts.push({
            version: 1,
            triggerSourceId: activation.targetSourceId,
            triggerNodeSourceId: closedTrigger.sourceId,
            contentSourceId: content.sourceId,
            kind,
            activationEvent: activation.event,
            anchor: {
                kind: activation.event === 'context-menu' ? 'pointer' : 'trigger',
                evidence: 'activation-event',
            },
            timing: {
                openDelayMs: Math.max(0, activation.openDelayMs ?? 0),
                evidence: 'captured-open-transition',
            },
            relationshipEvidence: relationship,
            trigger: {
                dataSlot: slot(openTrigger),
                accessibleName: sourceText(openTrigger),
                ariaHasPopup: openTrigger.attributes?.['aria-haspopup'] ?? null,
                ariaExpandedClosed: closedTrigger.attributes?.['aria-expanded'] ?? null,
                ariaExpandedOpen: openTrigger.attributes?.['aria-expanded'] ?? null,
            },
            content: {
                dataSlot: slot(content),
                role: content.attributes?.role ?? null,
                side: content.attributes?.['data-side'] ?? null,
                align: content.attributes?.['data-align'] ?? null,
                items: kind === 'menu' ? menuItems(content) : [],
            },
            gates: {
                openTransitionObserved: true,
                triggerContentRelationshipObserved: true,
                escapeDismissalObserved: observed('escape'),
                outsidePointerDismissalObserved: observed('outside-pointer'),
                triggerToggleDismissalObserved: observed('trigger-toggle'),
                focusRestorationObserved: dismissals.some((item) => item.closed && item.focusRestored === true),
            },
        });
    }
    return { version: 1, contracts, diagnostics };
}
