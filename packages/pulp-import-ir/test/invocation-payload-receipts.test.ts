import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyInvocationPayloadReceipts, captureInvocationPayloadReceipt, type IRNode } from '../src/index.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const evidence = {
    sourceRevision: 'source-revision',
    records: [{
        index: 7,
        activation: 'candidate-07',
        sourceId: 'dom/button:1',
        traces: [{
            process: 'preload', direction: 'renderer-to-main', transport: 'invoke',
            channel: 'resource:open', payload: ['/workspace/project', 'editor-a', true],
            ipcContract: {
                channel: 'resource:open', status: 'mapped-handler',
                renderer: { file: 'preload.ts', fileSha256: digest('file'), siteSha256: digest('site') },
            },
        }],
    }],
};
const spec = {
    action: 'resource.open.preferred', process: 'preload', direction: 'renderer-to-main',
    transport: 'invoke', channel: 'resource:open',
    fields: [
        { name: 'directory', argumentIndex: 0, type: 'path' as const,
            projection: { source: 'runtime-context' as const, key: 'project.directory' } },
        { name: 'targetID', argumentIndex: 1, type: 'string' as const,
            projection: { source: 'captured-invocation' as const } },
        { name: 'persistPreferred', argumentIndex: 2, type: 'boolean' as const,
            projection: { source: 'captured-invocation' as const } },
    ],
};

describe('invocation payload receipts', () => {
    it('projects typed invocation arguments without freezing runtime context values', () => {
        const receipt = captureInvocationPayloadReceipt(evidence, 0, spec);
        expect(receipt.payloadContract).toBe('{"$source":"runtime-context-fields","capturedFields":{"persistPreferred":true,"targetID":"editor-a"},"fields":{"directory":"project.directory"}}');
        expect(receipt.fields).toMatchObject([
            { name: 'directory', type: 'path', source: 'runtime-context' },
            { name: 'targetID', type: 'string', source: 'captured-invocation', capturedValue: 'editor-a' },
            { name: 'persistPreferred', type: 'boolean', source: 'captured-invocation', capturedValue: true },
        ]);
        expect(receipt.provenance.rendererSiteSha256).toBe(digest('site'));
    });

    it('fails closed on ambiguous traces, type drift, and incomplete static provenance', () => {
        expect(() => captureInvocationPayloadReceipt({ ...evidence, records: [{
            ...evidence.records[0], traces: [...evidence.records[0].traces, evidence.records[0].traces[0]],
        }] }, 0, spec)).toThrow(/expected one exact trace/);
        expect(() => captureInvocationPayloadReceipt({ ...evidence, records: [{
            ...evidence.records[0], traces: [{ ...evidence.records[0].traces[0],
                payload: ['/workspace/project', 'editor-a', 'true'] }],
        }] }, 0, spec)).toThrow(/does not match boolean/);
        expect(() => captureInvocationPayloadReceipt({ ...evidence, records: [{
            ...evidence.records[0], traces: [{ ...evidence.records[0].traces[0],
                ipcContract: { ...evidence.records[0].traces[0].ipcContract,
                    renderer: { ...evidence.records[0].traces[0].ipcContract.renderer, siteSha256: '' } } }],
        }] }, 0, spec)).toThrow(/immutable renderer contract/);
    });

    it('projects a receipt by action identity without matching visible text', () => {
        const receipt = captureInvocationPayloadReceipt(evidence, 0, spec);
        const root = { tag: 'frame', stable_anchor_id: 'root', source_node_id: 'root', children: [{
            tag: 'button', stable_anchor_id: 'open', source_node_id: 'open', children: [],
            provenance: {}, raw_source: 'observed-dom', confidence: 1,
            interaction: { actionBindingId: 'resource.open.preferred', event: 'click', required: true,
                disabled: false, focusable: true },
            attributes: { pulpHostAction: 'resource.open.preferred' },
        }], provenance: {}, raw_source: 'observed-dom', confidence: 1 } as IRNode;
        const report = applyInvocationPayloadReceipts(root, [receipt]);
        expect(report).toEqual([{ action: 'resource.open.preferred', sourceNodeIds: ['open'] }]);
        expect(root.children[0].interaction?.payloadContract).toBe(receipt.payloadContract);
        expect((root.children[0] as any).attributes.pulpPayloadProvenance).toContain('invocation-receipt://');
    });
});
