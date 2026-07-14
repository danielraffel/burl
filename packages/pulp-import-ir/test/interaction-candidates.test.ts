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
        expect(report.candidates[1].discoveredBy).toEqual(['semantic-control']);
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
        expect(report.candidates[0].modalities).toEqual(['activate']);
    });

    it('cannot silently omit listener-backed hover and activation surfaces', () => {
        const hover = node('tooltip-trigger', 'span');
        hover.attributes = { title: 'Search projects' };
        hover.interactionEvidence = {
            enabled: true,
            accessibleName: 'Search projects',
            listeners: [{ type: 'mouseenter' }],
            react: { propNames: ['onMouseEnter', 'onMouseLeave'] },
        };
        const clickable = node('card-trigger', 'div');
        clickable.interactionEvidence = {
            enabled: true,
            accessibleName: 'Open details',
            listeners: [],
            react: { propNames: ['onClick', 'onKeyDown'] },
        };
        const decorative = node('decorative', 'div');
        decorative.interactionEvidence = {
            enabled: true,
            listeners: [{ type: 'mouseleave' }],
        };
        const root = node('root', 'main', [hover, clickable, decorative]);
        root.interactionEvidence = {
            enabled: true,
            listeners: [{ type: 'click' }, { type: 'focusin' }],
        };
        const report = extractInteractionCandidates(root);
        expect(report.candidates.map((item) => item.sourceId)).toEqual(['card-trigger', 'tooltip-trigger']);
        expect(report.candidates[0]).toMatchObject({
            modalities: ['activate'], discoveredBy: ['react-event-prop'],
        });
        expect(report.candidates[1]).toMatchObject({
            modalities: ['hover'], discoveredBy: ['captured-listener', 'react-event-prop'],
        });
    });

    it('excludes offscreen form mirrors from the visible interaction census', () => {
        const visible = node('visible', 'textarea');
        const formMirror = node('form-mirror', 'input');
        formMirror.rect = { x: -1, y: -1, width: 1, height: 1 };
        const report = extractInteractionCandidates(node('root', 'main', [visible, formMirror]));
        expect(report.candidates.map((item) => item.sourceId)).toEqual(['visible']);
    });

    it('uses an explicit capture viewport instead of a scroll-height root', () => {
        const root = node('root', 'main', [node('inside', 'button'), node('below-fold', 'button')]);
        root.rect = { x: 0, y: 0, width: 100, height: 1000 };
        root.children[1].rect = { x: 0, y: 600, width: 40, height: 20 };
        const report = extractInteractionCandidates(root, [], {
            viewport: { x: 0, y: 0, width: 100, height: 100 },
        });
        expect(report.candidates.map((item) => item.sourceId)).toEqual(['inside']);
    });
});
