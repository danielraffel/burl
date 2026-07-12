import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('native DesignIR v1 projection', () => {
    it('projects observed native controls without changing stable identity', () => {
        const source: ObservedDomNode = {
            sourceId: 'root',
            tagName: 'main',
            computedStyle: { display: 'flex', flexDirection: 'column' },
            rect: { x: 0, y: 0, width: 1200, height: 800 },
            children: [{
                sourceId: 'composer',
                tagName: 'textarea',
                attributes: { 'aria-label': 'Message composer' },
                computedStyle: { display: 'flex', fontSize: '14px' },
                rect: { x: 297, y: 636, width: 873, height: 64 },
                children: [],
            }],
        };
        const ir = lowerObservedDom(source, '2026-07-11T20:00:00.000Z');
        const native = toNativeDesignIrV1(ir, {
            sourceFile: '/clean/palot',
            importedAt: '2026-07-11T20:00:00.000Z',
            sourceRevision: 'fd63a75',
        });
        expect(native.root.stable_anchor_id).toBe('observed-dom:root');
        const child = (native.root.children as Record<string, unknown>[])[0];
        expect(child.type).toBe('text_editor');
        expect(child.attributes).toMatchObject({ accessibility_name: 'Message composer' });
        expect(child.style).toMatchObject({ width: 873, height: 64, fontSize: 14 });
    });
});
