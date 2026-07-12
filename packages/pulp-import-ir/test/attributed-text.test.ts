import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toJSXLikeTree, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const rect = { x: 0, y: 0, width: 320, height: 24 };

function inlineNode(overrides: Partial<ObservedDomNode>): ObservedDomNode {
    return {
        sourceId: 'root',
        tagName: 'p',
        computedStyle: { display: 'block', fontFamily: 'Inter', fontSize: '14px' },
        rect,
        children: [],
        ...overrides,
    };
}

describe('observed DOM attributed text', () => {
    it('preserves atomic inline children interleaved with shaped text', () => {
        const svg = inlineNode({ sourceId: 'timer/svg', tagName: 'svg', computedStyle: { display: 'inline-block' }, rect: { x: 0, y: 4, width: 8, height: 8 } });
        const source = inlineNode({
            sourceId: 'timer', tagName: 'span', computedStyle: { display: 'inline-flex', flexWrap: 'nowrap', whiteSpace: 'nowrap', fontFamily: 'Inter', fontSize: '14px' },
            content: [{ kind: 'child', sourceId: svg.sourceId }, { kind: 'text', text: '7m 58s', rect: { x: 10, y: 0, width: 44, height: 18 } }],
            children: [svg],
        });
        const ir = lowerObservedDom(source, 'now');
        expect(ir.tag).toBe('View');
        expect(ir.meta?.role).toBeUndefined();
        expect(ir.children.map((child) => child.tag)).toEqual(['Icon', 'Label']);
        expect(ir.children[1].text?.text).toBe('7m 58s');
        expect(ir.children[1].layout).toMatchObject({ width: 44, height: 18 });
        const button = inlineNode({
            sourceId: 'button', tagName: 'button', computedStyle: { display: 'inline-flex' },
            content: [{ kind: 'child', sourceId: 'timer' }], children: [source],
        });
        const buttonIr = lowerObservedDom(button, 'now');
        expect(buttonIr.children).toHaveLength(1);
        expect(buttonIr.children[0].children.map((child) => child.tag)).toEqual(['Icon', 'Label']);
    });

    it('preserves text image Unicode text order and one parent action target', () => {
        const image = inlineNode({ sourceId: 'line/img', tagName: 'img', computedStyle: { display: 'inline-block' }, rect: { x: 20, y: 0, width: 12, height: 12 } });
        const source = inlineNode({
            sourceId: 'line', tagName: 'span', attributes: { 'data-pulp-action': 'open' },
            computedStyle: { display: 'inline-flex', flexWrap: 'nowrap', whiteSpace: 'pre', fontFamily: 'Inter' },
            content: [
                { kind: 'text', text: '前 ', rect: { x: 0, y: 0, width: 20, height: 16 } },
                { kind: 'child', sourceId: image.sourceId },
                { kind: 'text', text: ' 後🙂', rect: { x: 32, y: 0, width: 38, height: 16 } },
            ], children: [image],
        });
        const ir = lowerObservedDom(source, 'now', { applicationActions: ['open'] });
        expect(ir.children.map((child) => child.text?.text ?? child.tag)).toEqual(['前 ', 'Image', ' 後🙂']);
        expect(ir.interaction?.actionBindingId).toBe('open');
        expect(ir.children.every((child) => child.interaction === undefined)).toBe(true);
    });

    it('fails closed when a mixed inline composite may wrap or lacks text geometry', () => {
        const image = inlineNode({ sourceId: 'img', tagName: 'img', computedStyle: { display: 'inline-block' } });
        expect(() => lowerObservedDom(inlineNode({ content: [{ kind: 'text', text: 'a', rect }, { kind: 'child', sourceId: 'img' }], children: [image] }), 'now')).toThrow(/mixed inline wrapping is unsupported/);
        expect(() => lowerObservedDom(inlineNode({ computedStyle: { display: 'inline-flex', flexWrap: 'nowrap' }, content: [{ kind: 'text', text: 'a' }, { kind: 'child', sourceId: 'img' }], children: [image] }), 'now')).toThrow(/requires captured geometry/);
    });

    it('preserves direct text and inline children in DOM order', () => {
        const source = inlineNode({
            content: [
                { kind: 'text', text: 'Open ' },
                { kind: 'child', sourceId: 'span' },
                { kind: 'text', text: ' then ' },
                { kind: 'child', sourceId: 'code' },
                { kind: 'text', text: '.' },
            ],
            children: [
                inlineNode({ sourceId: 'span', tagName: 'span', text: 'café', computedStyle: { display: 'inline', fontWeight: '700' } }),
                inlineNode({ sourceId: 'code', tagName: 'code', text: 'x🙂', computedStyle: { display: 'inline', fontFamily: 'Mono' } }),
            ],
        });

        const ir = lowerObservedDom(source, '2026-07-11T20:00:00.000Z');
        expect(ir.tag).toBe('Label');
        expect(ir.children).toEqual([]);
        expect(ir.text?.text).toBe('Open café then x🙂.');
        expect(ir.textRuns).toEqual([
            expect.objectContaining({ start: 0, end: 5 }),
            expect.objectContaining({ start: 5, end: 10, fontWeight: 700 }),
            expect.objectContaining({ start: 10, end: 16 }),
            expect.objectContaining({ start: 16, end: 21, fontFamily: 'Mono', semanticKind: 'inline_code' }),
            expect.objectContaining({ start: 21, end: 22 }),
        ]);
        expect(toJSXLikeTree(ir).props.textRuns).toEqual(ir.textRuns);
    });

    it('preserves significant pre and code whitespace', () => {
        const source = inlineNode({
            tagName: 'pre',
            computedStyle: { display: 'block', whiteSpace: 'pre', fontFamily: 'Mono' },
            content: [
                { kind: 'text', text: '  alpha\n' },
                { kind: 'child', sourceId: 'code' },
            ],
            children: [inlineNode({
                sourceId: 'code',
                tagName: 'code',
                text: '  beta\n',
                computedStyle: { display: 'inline', whiteSpace: 'pre', fontFamily: 'Mono' },
            })],
        });
        const ir = lowerObservedDom(source, '2026-07-11T20:00:00.000Z');
        expect(ir.text?.text).toBe('  alpha\n  beta\n');
        expect(ir.textRuns?.[1]).toMatchObject({ start: 8, end: 15, semanticKind: 'inline_code' });
    });

    it('fails closed for legacy mixed captures and malformed content order', () => {
        const child = inlineNode({ sourceId: 'child', tagName: 'span', text: 'child', computedStyle: { display: 'inline' } });
        expect(() => lowerObservedDom(inlineNode({ text: 'parent', children: [child] }), 'now')).toThrow(/ambiguous legacy mixed text/);
        expect(() => lowerObservedDom(inlineNode({
            content: [{ kind: 'text', text: 'parent only' }],
            children: [child],
        }), 'now')).toThrow(/reference every child exactly once/);
        expect(() => lowerObservedDom(inlineNode({
            tagName: 'main',
            content: [{ kind: 'text', text: 'unrepresentable' }],
        }), 'now')).toThrow(/outside an inline-text container/);
        expect(() => lowerObservedDom(inlineNode({
            content: [{ kind: 'other' } as never],
        }), 'now')).toThrow(/malformed ordered content/);
        expect(() => lowerObservedDom(inlineNode({
            content: [{ kind: 'text', text: 'a', rect }, { kind: 'child', sourceId: 'stale' }],
        }), 'now')).toThrow(/reference every child exactly once/);
    });

    it('emits canonical native textRuns with UTF-8 byte ranges', () => {
        const source = inlineNode({
            content: [{ kind: 'text', text: 'A' }, { kind: 'child', sourceId: 'code' }],
            children: [inlineNode({ sourceId: 'code', tagName: 'code', text: 'λ', computedStyle: { display: 'inline' } })],
        });
        const native = toNativeDesignIrV1(lowerObservedDom(source, 'now'), { sourceFile: '/fixture', importedAt: 'now' });
        expect(native.root.content).toBe('Aλ');
        expect(native.root.textRuns).toEqual([
            expect.objectContaining({ start: 0, end: 1 }),
            expect.objectContaining({ start: 1, end: 3, semanticKind: 'inline_code' }),
        ]);
    });
});
