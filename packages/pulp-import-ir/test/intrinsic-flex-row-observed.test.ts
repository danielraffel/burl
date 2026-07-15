import { describe, expect, it } from 'vitest';
import {
    lowerObservedDom,
    toNativeDesignIrV1,
    type ObservedDomNode,
} from '../src/index.js';

const textLeaf = (sourceId: string, text: string, x: number, width: number,
                  extra: Partial<ObservedDomNode> = {}): ObservedDomNode => ({
    sourceId,
    tagName: 'span',
    rect: { x, y: 9, width, height: 20 },
    children: [],
    content: [{ kind: 'text', text, rect: { x, y: 10, width, height: 18 } }],
    computedStyle: {
        display: 'block',
        width: `${width}px`,
        minWidth: '0px',
        flexGrow: '0',
        flexShrink: '1',
        flexBasis: 'auto',
        whiteSpace: 'nowrap',
        overflowX: 'hidden',
        overflowY: 'hidden',
    },
    styleProvenanceWinners: { width: 'auto', 'min-width': '0px' },
    ...extra,
});

describe('source-shaped intrinsic flex action rows', () => {
    it('preserves min-width zero on intrinsic text and auto margin only on the trailing child', () => {
        const row: ObservedDomNode = {
            sourceId: 'action-row',
            tagName: 'button',
            rect: { x: 0, y: 0, width: 420, height: 40 },
            computedStyle: {
                display: 'flex',
                width: '420px',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '10px',
                paddingLeft: '12px',
                paddingRight: '12px',
            },
            children: [
                textLeaf('verb', 'Open', 12, 34),
                textLeaf('resource', 'resource.ext', 56, 84),
                textLeaf('timestamp', '1s', 394, 14, {
                    computedStyle: {
                        display: 'block',
                        width: '14px',
                        minWidth: 'auto',
                        flexGrow: '0',
                        flexShrink: '0',
                        flexBasis: 'auto',
                        marginLeft: '244px',
                        whiteSpace: 'nowrap',
                    },
                    styleProvenance: {
                        'margin-left': [{ value: 'auto', origin: 'authored' }],
                    },
                    styleProvenanceCompleteProperties: ['margin-left'],
                    styleProvenanceWinners: { width: 'auto', 'margin-left': 'auto' },
                }),
            ],
        };

        const typed = lowerObservedDom(row, '2026-07-15T12:00:00Z');
        expect(typed.layout?.gap).toBe(10);
        expect(typed.children[0].layout).toMatchObject({ width: 'auto', minWidth: 0, flexGrow: 0, flexShrink: 1 });
        expect(typed.children[1].layout).toMatchObject({ width: 'auto', minWidth: 0, flexGrow: 0, flexShrink: 1 });
        expect(typed.children[0].layout?.marginLeft).not.toBe('auto');
        expect(typed.children[1].layout?.marginLeft).not.toBe('auto');
        expect(typed.children[2].layout?.marginLeft).toBe('auto');

        const native = toNativeDesignIrV1(typed, {
            sourceFile: '/fixtures/source-shaped-flex-row.json',
            importedAt: '2026-07-15T12:00:00Z',
        });
        expect(native.root.children[0].style.minWidth).toBe(0);
        expect(native.root.children[1].style.minWidth).toBe(0);
        expect(native.root.children[2].layout.marginLeft).toBe('auto');
    });
});
