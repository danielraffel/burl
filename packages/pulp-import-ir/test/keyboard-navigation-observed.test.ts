import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function source(tabindex: string): ObservedDomNode {
    return { sourceId: 'button', tagName: 'button', attributes: { tabindex }, text: 'Run',
        computedStyle: { display: 'flex' }, rect: { x: 0, y: 0, width: 80, height: 30 }, children: [] };
}

describe('observed keyboard navigation', () => {
    it.each([['2', 'true'], ['0', 'true'], ['-1', 'false']])('preserves tabindex %s', (tabindex, focusable) => {
        const native = toNativeDesignIrV1(lowerObservedDom(source(tabindex), 'now'),
            { sourceFile: '/button', importedAt: 'now' });
        expect(native.root.attributes).toMatchObject({ tabIndex: tabindex, focusable });
    });
});
