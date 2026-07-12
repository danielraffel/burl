import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const lower = (flexDirection: string) => lowerObservedDom({
    sourceId: flexDirection, tagName: 'div', rect: { x: 0, y: 0, width: 120, height: 80 }, children: [],
    computedStyle: { display: 'flex', flexDirection },
} as ObservedDomNode, 'now');

describe('observed CSS flex-direction route', () => {
    it('preserves all four directions without rewriting reverse variants', () => {
        for (const direction of ['row', 'row-reverse', 'column', 'column-reverse'] as const) {
            const ir = lower(direction);
            expect(ir.layout?.flexDirection).toBe(direction);
            expect(toNativeDesignIrV1(ir, { sourceFile: '/direction', importedAt: 'now' }).root.layout?.direction)
                .toBe(direction);
        }
    });
});
