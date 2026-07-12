import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toJSXLikeTree, type ObservedDomNode } from '../src/index.js';

const fixture: ObservedDomNode = {
    sourceId: 'root',
    tagName: 'main',
    computedStyle: {
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgb(20, 20, 20)',
    },
    rect: { x: 0, y: 0, width: 1200, height: 800 },
    children: [
        {
            sourceId: 'new-session',
            tagName: 'button',
            text: 'New Session',
            computedStyle: {
                display: 'flex',
                fontFamily: 'Inter',
                fontSize: '13px',
                fontWeight: '500',
                color: 'rgb(255, 255, 255)',
                borderRadius: '10.5px',
            },
            rect: { x: 8, y: 54, width: 264, height: 32 },
            children: [],
        },
        {
            sourceId: 'composer',
            tagName: 'textarea',
            attributes: {
                'aria-label': 'Message composer',
                'data-pulp-semantic-id': 'chat.composer',
                'data-pulp-action': 'chat.send',
            },
            computedStyle: { display: 'block', fontSize: '14px' },
            rect: { x: 297, y: 636.5, width: 873, height: 64 },
            children: [],
        },
    ],
};

describe('observed DOM adapter', () => {
    it('lowers stable source IDs, geometry, paint, text, and native controls', () => {
        const ir = lowerObservedDom(fixture, '2026-07-11T20:00:00.000Z');
        expect(ir.stable_anchor_id).toBe('observed-dom:root');
        expect(ir.children[0].tag).toBe('Button');
        expect(ir.children[0].stable_anchor_id).toBe('observed-dom:new-session');
        expect(ir.children[0].text?.text).toBe('New Session');
        expect(ir.children[0].paint?.borderRadius).toBe(10.5);
        expect(ir.children[1].tag).toBe('TextEditor');
        expect(ir.children[1].meta?.semantic_id).toBe('chat.composer');
        expect(ir.children[1].confidence).toBe('PASS');
        expect(ir.children[1].layout).toMatchObject({ display: 'flex', flexDirection: 'column' });
    });

    it('feeds the existing prop-applier tree without a second renderer', () => {
        const jsx = toJSXLikeTree(lowerObservedDom(fixture, '2026-07-11T20:00:00.000Z'));
        expect(jsx.children[0].props.key).toBe('observed-dom:new-session');
        expect(jsx.children[0].props.width).toBe(264);
        expect(jsx.children[0].props.text).toBe('New Session');
        expect(jsx.children[1].props.accessibilityLabel).toBe('Message composer');
        expect(jsx.children[1].props['data-pulp-action']).toBe('chat.send');
    });

    it('rejects duplicate source identities', () => {
        const duplicate = structuredClone(fixture);
        duplicate.children[1].sourceId = 'new-session';
        expect(() => lowerObservedDom(duplicate, '2026-07-11T20:00:00.000Z')).toThrow(/unique/);
    });
});
