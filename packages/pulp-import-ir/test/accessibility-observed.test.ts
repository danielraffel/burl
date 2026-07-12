import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function source(attributes: Record<string, string>): ObservedDomNode {
    return {
        sourceId: 'control', tagName: 'button', attributes, text: 'Visible text',
        computedStyle: { display: 'flex' }, rect: { x: 0, y: 0, width: 80, height: 30 }, children: [],
    };
}

describe('observed DOM accessibility projection', () => {
    it('preserves role, accessible name, and ARIA states', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source({
            role: 'switch', 'aria-label': 'Enable sync', 'aria-pressed': 'mixed',
            'aria-checked': 'true', 'aria-disabled': 'false', 'aria-hidden': 'false',
        }), 'now'), { sourceFile: '/control', importedAt: 'now' });
        expect(native.root.attributes).toMatchObject({
            role: 'switch', accessibility_name: 'Enable sync', accessibility_pressed: 'mixed',
            accessibility_checked: 'true', accessibility_disabled: 'false', accessibility_hidden: 'false',
        });
    });

    it('uses title when an explicit ARIA label is absent', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source({ title: 'Open details' }), 'now'),
            { sourceFile: '/control', importedAt: 'now' });
        expect(native.root.attributes.accessibility_name).toBe('Open details');
    });
});
