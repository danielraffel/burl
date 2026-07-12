import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function source(stateStyles: ObservedDomNode['stateStyles']): ObservedDomNode {
    return {
        sourceId: 'button', tagName: 'button', text: 'Run', computedStyle: { display: 'flex' }, stateStyles,
        rect: { x: 0, y: 0, width: 80, height: 30 }, children: [],
    };
}

describe('CSS focus-visible to native keyboard focus', () => {
    it('canonicalizes focus-visible to the focused native skin', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source({
            'focus-visible': { backgroundColor: 'rgb(12, 34, 56)', outlineColor: 'rgb(1, 2, 3)', outlineWidth: '2px' },
        }), 'now'), { sourceFile: '/button', importedAt: 'now' });
        expect(native.root.visualSkin?.states).toHaveProperty('focused');
        expect(native.root.visualSkin?.states).not.toHaveProperty('focus-visible');
    });

    it('gives explicit focused receipt precedence over focus-visible alias', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source({
            'focus-visible': { backgroundColor: 'rgb(255, 0, 0)' },
            focused: { backgroundColor: 'rgb(0, 255, 0)' },
        }), 'now'), { sourceFile: '/button', importedAt: 'now' });
        expect(native.root.visualSkin?.states.focused.background).toMatchObject({ r: 0, g: 255, b: 0, a: 255 });
    });
});
