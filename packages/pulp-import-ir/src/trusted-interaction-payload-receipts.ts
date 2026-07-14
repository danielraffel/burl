import type { IRNode } from './types.js';

interface InteractionEvidenceEvent {
    type?: unknown;
    isTrusted?: unknown;
}

interface InteractionEvidenceScenario {
    id?: unknown;
    binding?: {
        action?: unknown;
        payloadReceipt?: { source?: unknown };
    } | null;
    action?: {
        target?: {
            role?: unknown;
            name?: unknown;
        };
    };
    payloadReceipt?: {
        source?: unknown;
        value?: unknown;
    } | null;
    events?: InteractionEvidenceEvent[];
}

export interface TrustedInteractionPayloadReceiptEvidence {
    scenarios?: InteractionEvidenceScenario[];
}

export interface TrustedInteractionPayloadReceiptProjection {
    scenarioId: string;
    action: string;
    role: string;
    name: string;
    payload: string;
    sourceNodeIds: string[];
}

export interface TrustedInteractionPayloadReceiptReport {
    projections: TrustedInteractionPayloadReceiptProjection[];
    patchedNodeCount: number;
}

function normalizedText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function subtreeText(node: IRNode): string {
    const own = normalizedText((node as any).content);
    const child = node.children.map(subtreeText).filter(Boolean).join(' ');
    return normalizedText([own, child].filter(Boolean).join(' '));
}

function walk(node: IRNode, visit: (current: IRNode) => void): void {
    visit(node);
    node.children.forEach((child) => walk(child, visit));
}

function receiptScenarios(evidence: TrustedInteractionPayloadReceiptEvidence): Array<{
    scenarioId: string;
    action: string;
    role: string;
    name: string;
    payload: string;
}> {
    const result: Array<{ scenarioId: string; action: string; role: string; name: string; payload: string }> = [];
    for (const [index, scenario] of (evidence.scenarios ?? []).entries()) {
        if (!scenario.payloadReceipt && !scenario.binding?.payloadReceipt) continue;
        const scenarioId = normalizedText(scenario.id) || `scenario-${index}`;
        const action = normalizedText(scenario.binding?.action);
        const role = normalizedText(scenario.action?.target?.role);
        const name = normalizedText(scenario.action?.target?.name);
        const payload = normalizedText(scenario.payloadReceipt?.value);
        const receiptSource = normalizedText(scenario.payloadReceipt?.source);
        const bindingReceiptSource = normalizedText(scenario.binding?.payloadReceipt?.source);
        if (!action || !role || !name || !payload) {
            throw new Error(`trusted interaction payload receipt ${scenarioId} is missing action, role, name, or payload`);
        }
        if (receiptSource !== 'associated-control-value' || bindingReceiptSource !== 'associated-control-value') {
            throw new Error(`trusted interaction payload receipt ${scenarioId} has an unsupported receipt source`);
        }
        const trustedClick = (scenario.events ?? []).some((event) =>
            event.type === 'click' && event.isTrusted === true);
        if (!trustedClick) {
            throw new Error(`trusted interaction payload receipt ${scenarioId} lacks a trusted click event`);
        }
        result.push({ scenarioId, action, role, name, payload });
    }
    if (result.length === 0) {
        throw new Error('interaction evidence contains no trusted payload receipts');
    }
    return result;
}

export function applyTrustedInteractionPayloadReceipts(
    root: IRNode,
    evidence: TrustedInteractionPayloadReceiptEvidence,
): TrustedInteractionPayloadReceiptReport {
    const projections: TrustedInteractionPayloadReceiptProjection[] = [];
    for (const receipt of receiptScenarios(evidence)) {
        const sourceNodeIds: string[] = [];
        walk(root, (node) => {
            const attributes = ((node as any).attributes ?? {}) as Record<string, unknown>;
            if (normalizedText(attributes.role) !== receipt.role || subtreeText(node) !== receipt.name) return;
            const existingAction = normalizedText(node.interaction?.actionBindingId ?? attributes.pulpHostAction);
            if (existingAction && existingAction !== receipt.action) {
                throw new Error(`trusted interaction payload receipt ${receipt.scenarioId} conflicts with ${existingAction} on ${node.source_node_id ?? node.stable_anchor_id}`);
            }
            node.interaction = {
                ...(node.interaction ?? {
                    event: 'click',
                    required: true,
                    disabled: false,
                    focusable: true,
                }),
                actionBindingId: receipt.action,
                event: 'click',
                payloadContract: receipt.payload,
                required: true,
            };
            (node as any).attributes = {
                ...attributes,
                action_binding_id: receipt.action,
                pulpHostAction: receipt.action,
                pulpEventContract: 'click',
                pulpPayloadContract: receipt.payload,
            };
            sourceNodeIds.push(node.source_node_id ?? node.stable_anchor_id);
        });
        if (sourceNodeIds.length === 0) {
            throw new Error(`trusted interaction payload receipt ${receipt.scenarioId} matched no ${receipt.role} named ${receipt.name}`);
        }
        projections.push({ ...receipt, sourceNodeIds });
    }
    return {
        projections,
        patchedNodeCount: projections.reduce((sum, projection) => sum + projection.sourceNodeIds.length, 0),
    };
}
