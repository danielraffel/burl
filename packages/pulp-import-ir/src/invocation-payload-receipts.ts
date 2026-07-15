import { createHash } from 'node:crypto';
import type { IRNode } from './types.js';

export type InvocationPayloadValueType = 'string' | 'path' | 'boolean' | 'number';

export interface InvocationPayloadFieldSpec {
    name: string;
    argumentIndex: number;
    type: InvocationPayloadValueType;
    projection:
        | { source: 'runtime-context'; key: string }
        | { source: 'captured-invocation' };
}

export interface InvocationPayloadReceiptSpec {
    action: string;
    process: string;
    direction: string;
    transport: string;
    channel: string;
    fields: InvocationPayloadFieldSpec[];
}

interface InvocationTrace {
    process?: unknown;
    direction?: unknown;
    transport?: unknown;
    channel?: unknown;
    payload?: unknown;
    ipcContract?: {
        channel?: unknown;
        status?: unknown;
        renderer?: {
            file?: unknown;
            fileSha256?: unknown;
            siteSha256?: unknown;
        };
    } | null;
}

export interface InvocationTraceRecord {
    index?: unknown;
    activation?: unknown;
    sourceId?: unknown;
    traces?: InvocationTrace[];
}

export interface InvocationTraceEvidence {
    sourceRevision?: unknown;
    records?: InvocationTraceRecord[];
}

export interface InvocationPayloadFieldReceipt {
    name: string;
    argumentIndex: number;
    type: InvocationPayloadValueType;
    source: 'runtime-context' | 'captured-invocation';
    runtimeContextKey?: string;
    observedValueSha256: string;
    capturedValue?: string | boolean | number;
}

export interface InvocationPayloadReceipt {
    schema: 'pulp-invocation-payload-receipt-v1';
    action: string;
    payloadContract: string;
    provenance: {
        sourceRevision: string;
        recordIndex: number;
        activation: string;
        sourceId: string;
        process: string;
        direction: string;
        transport: string;
        channel: string;
        rendererFile: string;
        rendererFileSha256: string;
        rendererSiteSha256: string;
    };
    fields: InvocationPayloadFieldReceipt[];
}

export interface InvocationPayloadProjectionReport {
    action: string;
    sourceNodeIds: string[];
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const hash = (value: unknown): string => createHash('sha256')
    .update(JSON.stringify(value)).digest('hex');
const isSha256 = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

function validateValue(value: unknown, type: InvocationPayloadValueType): boolean {
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === 'string' && value.length > 0;
}

function sortedObject(entries: Array<[string, unknown]>): Record<string, unknown> {
    return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

export function captureInvocationPayloadReceipt(
    evidence: InvocationTraceEvidence,
    recordIndex: number,
    spec: InvocationPayloadReceiptSpec,
): InvocationPayloadReceipt {
    const sourceRevision = text(evidence.sourceRevision);
    const record = evidence.records?.[recordIndex];
    if (!sourceRevision || !record) throw new Error('invocation receipt source provenance is incomplete');
    if (!text(spec.action) || !text(spec.channel) || !spec.fields.length)
        throw new Error('invocation receipt specification is incomplete');
    const names = new Set<string>();
    for (const field of spec.fields) {
        if (!text(field.name) || names.has(field.name) || !Number.isInteger(field.argumentIndex) ||
            field.argumentIndex < 0 || !['string', 'path', 'boolean', 'number'].includes(field.type))
            throw new Error(`invocation receipt field ${field.name || '<unnamed>'} is invalid`);
        names.add(field.name);
        if (field.projection.source === 'runtime-context' && !text(field.projection.key))
            throw new Error(`invocation receipt field ${field.name} has no runtime context key`);
    }
    const matches = (record.traces ?? []).filter((trace) =>
        trace.process === spec.process && trace.direction === spec.direction &&
        trace.transport === spec.transport && trace.channel === spec.channel);
    if (matches.length !== 1)
        throw new Error(`invocation receipt expected one exact trace and found ${matches.length}`);
    const trace = matches[0];
    if (!Array.isArray(trace.payload)) throw new Error('invocation receipt trace has no argument payload');
    const payload = trace.payload;
    const contract = trace.ipcContract;
    const rendererFile = text(contract?.renderer?.file);
    const rendererFileSha256 = text(contract?.renderer?.fileSha256);
    const rendererSiteSha256 = text(contract?.renderer?.siteSha256);
    if (contract?.channel !== spec.channel || !text(contract?.status).startsWith('mapped-') ||
        !rendererFile || !isSha256(rendererFileSha256) || !isSha256(rendererSiteSha256))
        throw new Error('invocation receipt lacks a mapped immutable renderer contract');

    const runtimeEntries: Array<[string, unknown]> = [];
    const capturedEntries: Array<[string, unknown]> = [];
    const fields = spec.fields.map((field): InvocationPayloadFieldReceipt => {
        const value = payload[field.argumentIndex];
        if (!validateValue(value, field.type))
            throw new Error(`invocation receipt field ${field.name} does not match ${field.type}`);
        if (field.projection.source === 'runtime-context') {
            runtimeEntries.push([field.name, field.projection.key]);
            return { name: field.name, argumentIndex: field.argumentIndex, type: field.type,
                source: 'runtime-context', runtimeContextKey: field.projection.key,
                observedValueSha256: hash(value) };
        }
        capturedEntries.push([field.name, value]);
        return { name: field.name, argumentIndex: field.argumentIndex, type: field.type,
            source: 'captured-invocation', capturedValue: value as string | boolean | number,
            observedValueSha256: hash(value) };
    });
    const payloadContract = JSON.stringify({
        $source: 'runtime-context-fields',
        ...(capturedEntries.length ? { capturedFields: sortedObject(capturedEntries) } : {}),
        ...(runtimeEntries.length ? { fields: sortedObject(runtimeEntries) } : {}),
    });
    const index = record.index;
    if (!Number.isInteger(index) || !text(record.activation) || !text(record.sourceId))
        throw new Error('invocation receipt record identity is incomplete');
    return {
        schema: 'pulp-invocation-payload-receipt-v1',
        action: spec.action,
        payloadContract,
        provenance: {
            sourceRevision,
            recordIndex: index as number,
            activation: text(record.activation),
            sourceId: text(record.sourceId),
            process: spec.process,
            direction: spec.direction,
            transport: spec.transport,
            channel: spec.channel,
            rendererFile,
            rendererFileSha256,
            rendererSiteSha256,
        },
        fields,
    };
}

export function applyInvocationPayloadReceipts(
    root: IRNode,
    receipts: InvocationPayloadReceipt[],
): InvocationPayloadProjectionReport[] {
    const reports: InvocationPayloadProjectionReport[] = [];
    for (const receipt of receipts) {
        if (receipt.schema !== 'pulp-invocation-payload-receipt-v1' || !text(receipt.action) ||
            !text(receipt.payloadContract) || !text(receipt.provenance?.sourceRevision) ||
            !isSha256(text(receipt.provenance?.rendererFileSha256)) ||
            !isSha256(text(receipt.provenance?.rendererSiteSha256)))
            throw new Error('invocation payload receipt provenance is incomplete');
        const sourceNodeIds: string[] = [];
        const visit = (node: IRNode) => {
            const attributes = ((node as any).attributes ?? {}) as Record<string, unknown>;
            const action = text(node.interaction?.actionBindingId) || text(attributes.pulpHostAction);
            if (action === receipt.action) {
                if (node.interaction) node.interaction.payloadContract = receipt.payloadContract;
                (node as any).attributes = {
                    ...attributes,
                    pulpPayloadContract: receipt.payloadContract,
                    pulpPayloadSource: 'runtime-context-and-captured-invocation-fields',
                    pulpPayloadSchema: 'application-action-fields-v1',
                    pulpPayloadProvenance:
                        `invocation-receipt://${receipt.provenance.sourceRevision}/${receipt.provenance.recordIndex}`,
                };
                sourceNodeIds.push(node.source_node_id ?? node.stable_anchor_id);
            }
            node.children.forEach(visit);
        };
        visit(root);
        if (!sourceNodeIds.length)
            throw new Error(`invocation payload receipt ${receipt.action} matched no imported action`);
        reports.push({ action: receipt.action, sourceNodeIds });
    }
    return reports;
}
