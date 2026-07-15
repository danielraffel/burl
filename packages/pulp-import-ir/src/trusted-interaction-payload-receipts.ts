import { createHash } from 'node:crypto';
import type { IRNode } from './types.js';

interface InteractionEvidenceEvent {
    type?: unknown;
    isTrusted?: unknown;
}

interface InteractionEvidenceScenario {
    id?: unknown;
    binding?: {
        action?: unknown;
        stateKey?: unknown;
        payloadReceipt?: { source?: unknown };
        activationReceipt?: { source?: unknown; policy?: unknown };
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
        componentKey?: unknown;
    } | null;
    activationReceipt?: {
        source?: unknown;
        policy?: unknown;
        identity?: unknown;
        componentKey?: unknown;
        commandIndex?: unknown;
        commandCount?: unknown;
        disabled?: unknown;
        handlerSource?: unknown;
        handlerSha256?: unknown;
        trustedClickObserved?: unknown;
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
    stateKey?: string;
    payload?: string;
    policy?: 'reversible' | 'navigation' | 'disabled' | 'unsafe';
    disabled?: boolean;
    commandIndex?: number;
    commandCount?: number;
    sourceNodeIds: string[];
}

export interface TrustedInteractionPayloadReceiptReport {
    projections: TrustedInteractionPayloadReceiptProjection[];
    patchedNodeCount: number;
}

function normalizedText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function commandIdentity(value: unknown): string {
    return normalizedText(value).replace(/\s+/g, '');
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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
    stateKey?: string;
    payload?: string;
    policy?: 'reversible' | 'navigation' | 'disabled' | 'unsafe';
    disabled?: boolean;
    commandIndex?: number;
    commandCount?: number;
}> {
    const result: Array<{ scenarioId: string; action: string; role: string; name: string; stateKey?: string; payload?: string;
        policy?: 'reversible' | 'navigation' | 'disabled' | 'unsafe'; disabled?: boolean;
        commandIndex?: number; commandCount?: number }> = [];
    for (const [index, scenario] of (evidence.scenarios ?? []).entries()) {
        if (!scenario.payloadReceipt && !scenario.binding?.payloadReceipt && !scenario.activationReceipt) continue;
        const scenarioId = normalizedText(scenario.id) || `scenario-${index}`;
        const action = normalizedText(scenario.binding?.action);
        const stateKey = normalizedText(scenario.binding?.stateKey) || undefined;
        const activationSource = normalizedText(scenario.activationReceipt?.source);
        const bindingActivationSource = normalizedText(scenario.binding?.activationReceipt?.source);
        if (activationSource === 'command-item-runtime' || bindingActivationSource === 'command-item-runtime') {
            const policy = normalizedText(scenario.activationReceipt?.policy) as 'reversible' | 'navigation' | 'disabled' | 'unsafe';
            const bindingPolicy = normalizedText(scenario.binding?.activationReceipt?.policy);
            const name = normalizedText(scenario.activationReceipt?.identity);
            const handlerSource = typeof scenario.activationReceipt?.handlerSource === 'string'
                ? scenario.activationReceipt.handlerSource : '';
            const handlerSha256 = normalizedText(scenario.activationReceipt?.handlerSha256);
            const commandIndex = scenario.activationReceipt?.commandIndex;
            const commandCount = scenario.activationReceipt?.commandCount;
            const allowedPolicies = new Set(['reversible', 'navigation', 'disabled', 'unsafe']);
            if (!action || !name || activationSource !== 'command-item-runtime' ||
                bindingActivationSource !== 'command-item-runtime' || !allowedPolicies.has(policy) ||
                policy !== bindingPolicy || !handlerSource || !/^[a-f0-9]{64}$/.test(handlerSha256) ||
                sha256(handlerSource) !== handlerSha256 || !Number.isInteger(commandIndex) ||
                !Number.isInteger(commandCount) || (commandIndex as number) < 0 ||
                (commandCount as number) < 1 || (commandIndex as number) >= (commandCount as number)) {
                throw new Error(`trusted command receipt ${scenarioId} has incomplete or inconsistent runtime evidence`);
            }
            const disabled = scenario.activationReceipt?.disabled === true || policy === 'disabled' || policy === 'unsafe';
            if (policy === 'disabled' && scenario.activationReceipt?.disabled !== true) {
                throw new Error(`trusted command receipt ${scenarioId} classified disabled without a disabled source control`);
            }
            if ((policy === 'reversible' || policy === 'navigation') &&
                scenario.activationReceipt?.trustedClickObserved !== true) {
                throw new Error(`trusted command receipt ${scenarioId} lacks a trusted click activation`);
            }
            let payload: string | undefined;
            if (scenario.binding?.payloadReceipt) {
                if (normalizedText(scenario.binding.payloadReceipt.source) !== 'command-item-react-key' ||
                    normalizedText(scenario.payloadReceipt?.source) !== 'command-item-react-key') {
                    throw new Error(`trusted command receipt ${scenarioId} has an unsupported payload source`);
                }
                payload = normalizedText(scenario.payloadReceipt?.componentKey);
                if (!payload || payload !== normalizedText(scenario.activationReceipt?.componentKey)) {
                    throw new Error(`trusted command receipt ${scenarioId} has an inconsistent React key payload`);
                }
            }
            result.push({ scenarioId, action, role: 'option', name, payload, policy, disabled,
                commandIndex: commandIndex as number, commandCount: commandCount as number });
            continue;
        }
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
        result.push({ scenarioId, action, role, name, stateKey, payload });
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
    const commandNodes: IRNode[] = [];
    const stateScopes = new WeakMap<IRNode, ReadonlySet<string>>();
    const indexStateScopes = (node: IRNode, inherited = new Set<string>()): void => {
        const scope = new Set(inherited);
        if (node.responsive?.applicationStateKey) scope.add(node.responsive.applicationStateKey);
        stateScopes.set(node, scope);
        node.children.forEach((child) => indexStateScopes(child, scope));
    };
    indexStateScopes(root);
    walk(root, (node) => {
        const attributes = ((node as any).attributes ?? {}) as Record<string, unknown>;
        if (normalizedText(attributes.role) === 'option' && normalizedText(attributes.sourceDataSlot) === 'command-item') {
            commandNodes.push(node);
        }
    });
    const projections: TrustedInteractionPayloadReceiptProjection[] = [];
    for (const receipt of receiptScenarios(evidence)) {
        const sourceNodeIds: string[] = [];
        walk(root, (node) => {
            const attributes = ((node as any).attributes ?? {}) as Record<string, unknown>;
            const isCommandReceipt = receipt.policy !== undefined;
            if (normalizedText(attributes.role) !== receipt.role) return;
            if (receipt.stateKey && !stateScopes.get(node)?.has(receipt.stateKey)) return;
            if (isCommandReceipt) {
                if (normalizedText(attributes.sourceDataSlot) !== 'command-item' ||
                    commandNodes.length !== receipt.commandCount || commandNodes[receipt.commandIndex!] !== node) return;
                const exactIdentity = commandIdentity(subtreeText(node)) === commandIdentity(receipt.name);
                if (!exactIdentity && !(receipt.policy === 'unsafe' && receipt.payload)) {
                    throw new Error(`trusted command receipt ${receipt.scenarioId} identity does not match its exact runtime command position`);
                }
            } else if (subtreeText(node) !== receipt.name) return;
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
                disabled: receipt.disabled ?? node.interaction?.disabled ?? false,
                event: 'click',
                ...(receipt.payload ? { payloadContract: receipt.payload } : {}),
                required: true,
            };
            (node as any).attributes = {
                ...attributes,
                action_binding_id: receipt.action,
                pulpHostAction: receipt.action,
                pulpEventContract: 'click',
                ...(receipt.payload ? { pulpPayloadContract: receipt.payload } : {}),
                ...(receipt.disabled ? { disabled: 'true', accessibility_disabled: 'true' } : {}),
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
