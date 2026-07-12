import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

function source(stateStyles: ObservedDomNode['stateStyles']): ObservedDomNode {
    return {
        sourceId: 'button', tagName: 'button', text: 'Run', computedStyle: {
            display: 'flex', backgroundColor: 'rgb(20, 20, 20)', color: 'white',
        }, stateStyles, rect: { x: 0, y: 0, width: 80, height: 30 }, children: [],
    };
}

describe('CSS active to native pressed state', () => {
    it('canonicalizes active without duplicate runtime state', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source({
            active: { backgroundColor: 'rgb(255, 0, 0)', color: 'white' },
        }), 'now'), { sourceFile: '/button', importedAt: 'now' });
        expect(native.root.visualSkin?.states).toHaveProperty('pressed');
        expect(native.root.visualSkin?.states).not.toHaveProperty('active');
    });

    it('gives explicitly captured pressed state precedence over active alias', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source({
            active: { backgroundColor: 'rgb(255, 0, 0)' },
            pressed: { backgroundColor: 'rgb(0, 255, 0)' },
        }), 'now'), { sourceFile: '/button', importedAt: 'now' });
        expect(native.root.visualSkin?.states.pressed).toMatchObject({
            background: { r: 0, g: 255, b: 0, a: 255 },
        });
    });
});
