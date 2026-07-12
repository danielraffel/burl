import { describe, expect, test } from 'bun:test';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed motion lowering', () => {
    test('carries a captured rotation animation into native attributes', () => {
        const source: ObservedDomNode = { sourceId: 'spinner', tagName: 'svg', attributes: {},
            computedStyle: { display: 'block', position: 'static' }, rect: { x: 0, y: 0, width: 16, height: 16 }, children: [],
            motion: [{ name: 'turn', durationMs: 800, delayMs: 0, easing: 'linear', iterations: 'infinite',
                direction: 'normal', fill: 'none', playState: 'running',
                keyframes: [{ offset: 0, easing: 'linear', composite: 'auto', transform: 'none' },
                    { offset: 1, easing: 'linear', composite: 'auto', transform: 'rotate(360deg)' }] }] };
        const native = toNativeDesignIrV1(lowerObservedDom(source, 'now'), { sourceFile: '/neutral', importedAt: 'now' });
        expect(native.root.attributes).toMatchObject({ motion_kind: 'rotation', motion_from: '0', motion_to: '360',
            motion_duration_seconds: '0.8', motion_iterations: '-1', motion_easing: 'linear' });
    });

    test('carries a captured opacity animation into native attributes', () => {
        const source: ObservedDomNode = { sourceId: 'pulse', tagName: 'span', attributes: {},
            computedStyle: { display: 'block', position: 'static' }, rect: { x: 0, y: 0, width: 8, height: 8 }, children: [],
            motion: [{ name: 'pulse', durationMs: 1000, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite',
                direction: 'alternate', fill: 'none', playState: 'running',
                keyframes: [{ offset: 0, easing: 'ease-in-out', composite: 'auto', opacity: '0.5' },
                    { offset: 1, easing: 'ease-in-out', composite: 'auto', opacity: '1' }] }] };
        const native = toNativeDesignIrV1(lowerObservedDom(source, 'now'), { sourceFile: '/neutral', importedAt: 'now' });
        expect(native.root.attributes).toMatchObject({ motion_kind: 'opacity', motion_from: '0.5', motion_to: '1' });
    });
});
