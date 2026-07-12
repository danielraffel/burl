import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('native DesignIR v1 projection', () => {
    it('preserves fixed icon width when flex-basis is auto', () => {
        const source: ObservedDomNode = {
            sourceId: 'button', tagName: 'button',
            computedStyle: { display: 'flex', flexDirection: 'row' },
            rect: { x: 0, y: 0, width: 120, height: 32 },
            children: [{
                sourceId: 'icon', tagName: 'svg', outerHtml: '<svg viewBox="0 0 16 16"/>',
                computedStyle: { display: 'block', flexGrow: '0', flexShrink: '0', flexBasis: 'auto' },
                rect: { x: 8, y: 8, width: 16, height: 16 }, children: [],
            }],
        };
        const native = toNativeDesignIrV1(lowerObservedDom(source, '2026-07-11T20:00:00.000Z'), {
            sourceFile: '/held-out/component', importedAt: '2026-07-11T20:00:00.000Z',
            inlineSvgCaptures: [{ sourceId: 'icon', outerHTML: '<svg viewBox="0 0 16 16"/>', computedColor: '#00c950' }],
        });
        const icon = (native.root.children as Record<string, unknown>[])[0];
        expect(icon.style).toMatchObject({ width: 16, height: 16 });
        expect(icon.layout).toMatchObject({ flexBasis: 'auto', width: 16, height: 16 });
    });

    it('projects observed native controls without changing stable identity', () => {
        const source: ObservedDomNode = {
            sourceId: 'root',
            tagName: 'main',
            computedStyle: { display: 'flex', flexDirection: 'column' },
            rect: { x: 0, y: 0, width: 1200, height: 800 },
            children: [{
                sourceId: 'composer',
                tagName: 'textarea',
                attributes: { 'aria-label': 'Message composer', placeholder: 'Send a follow-up message...' },
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
        expect(native.root.layout).toMatchObject({ widthMode: 'fill', heightMode: 'fill' });
        const child = (native.root.children as Record<string, unknown>[])[0];
        expect(child.type).toBe('text_editor');
        expect(child.attributes).toMatchObject({ accessibility_name: 'Message composer', placeholder: 'Send a follow-up message...' });
        expect(child.style).toMatchObject({ width: 873, height: 64, fontSize: 14 });
    });
});
