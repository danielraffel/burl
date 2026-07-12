import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

const source: ObservedDomNode = {
    sourceId: 'button', tagName: 'button', text: 'Run', computedStyle: {
        display: 'flex', backgroundColor: 'rgb(20, 20, 20)', color: 'white',
    }, stateStyles: { hover: { backgroundColor: 'rgb(10, 100, 210)', color: 'white' } },
    rect: { x: 0, y: 0, width: 80, height: 30 }, children: [],
};

describe('observed hover skin', () => {
    it('survives as the native hover state', () => {
        const native = toNativeDesignIrV1(lowerObservedDom(source, 'now'),
            { sourceFile: '/button', importedAt: 'now' });
        expect(native.root.visualSkin?.states.hover.background).toMatchObject({ r: 10, g: 100, b: 210, a: 255 });
    });
});
