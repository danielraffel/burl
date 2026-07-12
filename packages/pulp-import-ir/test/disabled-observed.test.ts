import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function source(attributes: Record<string, string>): ObservedDomNode {
    return {
        sourceId: 'control', tagName: 'button', attributes, text: 'Run',
        computedStyle: { display: 'flex' }, rect: { x: 0, y: 0, width: 80, height: 30 }, children: [],
    };
}

describe('observed disabled semantics', () => {
    it.each([{ disabled: '' }, { 'aria-disabled': 'true' }])('preserves disabled without an action binding: %o', (attributes) => {
        const native = toNativeDesignIrV1(lowerObservedDom(source(attributes), 'now'),
            { sourceFile: '/control', importedAt: 'now' });
        expect(native.root.attributes.disabled).toBe('true');
    });

    it('does not disable aria-disabled=false', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source({ 'aria-disabled': 'false' }), 'now'),
            { sourceFile: '/control', importedAt: 'now' });
        expect(native.root.attributes.disabled).toBeUndefined();
        expect(native.root.attributes.accessibility_disabled).toBe('false');
    });
});
