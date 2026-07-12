import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const node = (pointerEvents: string, inline = false): ObservedDomNode => ({
    sourceId: `pointer-${pointerEvents}-${inline}`,
    tagName: 'div',
    attributes: inline ? { style: `opacity: 0; pointer-events: ${pointerEvents};` } : {},
    computedStyle: { display: 'block', ...(inline ? {} : { pointerEvents }) },
    rect: { x: 0, y: 0, width: 100, height: 100 },
    children: [],
});

describe('observed pointer-events route', () => {
    it('makes pointer-events none non-hit-testable from computed or inline evidence', () => {
        for (const source of [node('none'), node('none', true)]) {
            const native = toNativeDesignIrV1(lowerObservedDom(source, 'now'), {
                sourceFile: '/pointer-events', importedAt: 'now',
            });
            expect(native.root.attributes.pulpHitTestable).toBe('false');
        }
    });

    it('leaves auto hit testing unchanged and fails closed for unknown values', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(node('auto'), 'now'), {
            sourceFile: '/pointer-events', importedAt: 'now',
        });
        expect(native.root.attributes.pulpHitTestable).toBeUndefined();
        expect(() => lowerObservedDom(node('painted'), 'now')).toThrow(/unsupported pointer-events/);
    });
});
