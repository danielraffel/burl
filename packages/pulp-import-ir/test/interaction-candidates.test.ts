import { describe, expect, it } from 'vitest';
import { extractInteractionCandidates, type ObservedDomNode } from '../src/index.js';

const node = (sourceId: string, tagName: string, children: ObservedDomNode[] = []): ObservedDomNode => ({
    sourceId, tagName, children, computedStyle: {}, rect: { x: 0, y: 0, width: 40, height: 20 },
});

describe('interaction candidate report', () => {
    it('fails closed until captured evidence and reviewed mappings exist', () => {
        const root = node('root', 'div', [node('z-button', 'button'), node('a-input', 'input')]);
        root.children[0].text = 'Run';
        const report = extractInteractionCandidates(root, [
            { sourceId: 'z-button', applicationAction: 'fixture.run' },
        ]);
        expect(report.candidates.map((item) => item.sourceId)).toEqual(['a-input', 'z-button']);
        expect(report.summary).toEqual({ total: 2, mapped: 1, unmapped: 1, missingEvidence: 2 });
        expect(report.candidates[1].accessibleName).toBe('Run');
    });

    it('preserves listener, React, activation, IPC, disabled, and reviewed evidence', () => {
        const control = node('control', 'button');
        control.attributes = { 'aria-label': 'Stop', disabled: '' };
        control.interactionEvidence = {
            enabled: false,
            accessibleName: 'Stop generation',
            listeners: [{ type: 'click', handlerLocation: 'composer.tsx:81' }],
            react: { componentName: 'StopButton', sourceLocation: 'composer.tsx:70', propNames: ['onClick'] },
            activation: {
                stateChanged: true, navigationChanged: false,
                ipc: [{ channel: 'opencode:abort', direction: 'invoke' }],
                changedAttributes: ['data-state'],
            },
        };
        const report = extractInteractionCandidates(control, [
            { sourceId: 'control', applicationAction: 'prompt.cancel' },
        ]);
        expect(report.summary).toEqual({ total: 1, mapped: 1, unmapped: 0, missingEvidence: 0 });
        expect(report.candidates[0]).toMatchObject({ enabled: false, accessibleName: 'Stop generation' });
        expect(report.candidates[0].evidence?.activation?.ipc[0].channel).toBe('opencode:abort');
    });
});
