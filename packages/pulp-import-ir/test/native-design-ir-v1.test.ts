import { describe, expect, it } from 'vitest';
import { applyObservedOverlayContracts, extractObservedOverlayContracts,
    applySourceBindingPolicy, lowerObservedDom, toNativeDesignIrV1,
    type ObservedDomNode } from '../src/index.js';

describe('native DesignIR v1 projection', () => {
    it('projects resolved observed grid tracks to the native grid engine', () => {
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'summary-grid', tagName: 'div',
            computedStyle: {
                display: 'grid', gridTemplateColumns: '72px 72px 72px',
                gridTemplateRows: '38px', columnGap: '8px', rowGap: '0px',
            },
            rect: { x: 0, y: 0, width: 232, height: 38 }, children: [],
        }, 'now'), { sourceFile: '/grid', importedAt: 'now' });

        expect(native.root.attributes).toMatchObject({
            pulpGridTemplateColumns: '72px 72px 72px',
            pulpGridTemplateRows: '38px',
        });
    });

    it('infers omitted grid tracks from unambiguous observed child geometry', () => {
        const cell = (sourceId: string, x: number, y: number, width: number, height: number): ObservedDomNode => ({
            sourceId, tagName: 'span', text: sourceId,
            computedStyle: { display: 'block', position: 'static' },
            rect: { x, y, width, height }, children: [],
        });
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'captured-grid', tagName: 'div',
            computedStyle: { display: 'grid', gap: '8px' },
            rect: { x: 10, y: 20, width: 232, height: 46 },
            children: [
                cell('a', 10, 20, 72, 18), cell('b', 90, 20, 72, 18), cell('c', 170, 20, 72, 18),
                cell('d', 10, 48, 72, 18), cell('e', 90, 48, 72, 18), cell('f', 170, 48, 72, 18),
            ],
        }, 'now'), { sourceFile: '/captured-grid', importedAt: 'now' });

        expect(native.root.attributes).toMatchObject({
            pulpGridTemplateColumns: '72px 72px 72px',
            pulpGridTemplateRows: '18px 18px',
        });
    });

    it('does not infer ambiguous observed grid spans', () => {
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'spanning-grid', tagName: 'div',
            computedStyle: { display: 'grid', gap: '8px' },
            rect: { x: 0, y: 0, width: 232, height: 38 },
            children: [{
                sourceId: 'normal', tagName: 'span', text: 'normal',
                computedStyle: { display: 'block', position: 'static' },
                rect: { x: 0, y: 0, width: 72, height: 18 }, children: [],
            }, {
                sourceId: 'span', tagName: 'span', text: 'span',
                computedStyle: { display: 'block', position: 'static' },
                rect: { x: 0, y: 20, width: 152, height: 18 }, children: [],
            }],
        }, 'now'), { sourceFile: '/spanning-grid', importedAt: 'now' });

        expect(native.root.attributes).not.toHaveProperty('pulpGridTemplateColumns');
    });

    it('preserves an observed repeated label-value grid as auto plus remaining width', () => {
        const cell = (sourceId: string, text: string, x: number, y: number, width: number,
                      textAlign: 'start' | 'right'): ObservedDomNode => ({
            sourceId, tagName: 'span', text,
            computedStyle: {
                display: 'block', position: 'static', textAlign,
                fontSize: '13px', lineHeight: '18px',
            },
            rect: { x, y, width, height: 18 }, children: [],
        });
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'usage-summary', tagName: 'div',
            computedStyle: { display: 'grid', gap: '2px 12px' },
            rect: { x: 778, y: 442.5, width: 232, height: 38 },
            children: [
                cell('cost-label', 'Avg cost / exchange', 778, 442.5, 121.4453, 'start'),
                cell('cost-value', '$0.01', 911.4453, 442.5, 98.5547, 'right'),
                cell('time-label', 'Avg time / exchange', 778, 462.5, 121.4453, 'start'),
                cell('time-value', '6m 28s', 911.4453, 462.5, 98.5547, 'right'),
            ],
        }, 'now'), { sourceFile: '/usage-summary', importedAt: 'now' });

        expect(native.root.attributes).toMatchObject({
            pulpGridTemplateColumns: 'auto 1fr',
            pulpGridTemplateRows: '18px 18px',
        });
    });

    it('positions absolute descendants from observed parent-relative geometry', () => {
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'tooltip', tagName: 'div',
            computedStyle: { display: 'block', position: 'static' },
            rect: { x: 154.5, y: 505, width: 118.898, height: 30 },
            children: [{
                sourceId: 'arrow', tagName: 'div',
                computedStyle: {
                    display: 'block', position: 'absolute', top: '4px', left: '54.5px',
                    width: '10px', height: '10px',
                },
                rect: { x: 206.929, y: 499.929, width: 14.142, height: 14.142 }, children: [],
            }],
        }, 'now'), { sourceFile: '/tooltip', importedAt: 'now' });

        const arrow = (native.root.children as Record<string, any>[])[0];
        expect(arrow.style).toMatchObject({ position: 'absolute', width: 10, height: 10 });
        expect(arrow.style.left).toBeCloseTo(52.429);
        expect(arrow.style.top).toBeCloseTo(-5.071);
        expect(arrow.style).not.toHaveProperty('right');
        expect(arrow.style).not.toHaveProperty('bottom');
    });

    it('does not double-apply translated absolute portal geometry', () => {
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'portal-host', tagName: 'div',
            computedStyle: { display: 'block', position: 'static', overflow: 'visible' },
            rect: { x: 0, y: 800, width: 1200, height: 0 },
            children: [{
                sourceId: 'popover', tagName: 'div',
                computedStyle: {
                    display: 'block', position: 'absolute', top: '0px', left: '0px',
                    width: '256px', height: '456px',
                    transform: 'matrix(1, 0, 0, 1, 766, 36.5)',
                },
                rect: { x: 766, y: 36.5, width: 256, height: 456 }, children: [],
            }],
        }, 'now'), { sourceFile: '/portal', importedAt: 'now' });

        const popover = (native.root.children as Record<string, any>[])[0];
        expect(popover.style).toMatchObject({
            position: 'absolute', left: 0, top: -800,
            transform: 'matrix(1, 0, 0, 1, 766, 36.5)',
        });
    });

    it('does not rewrite authored normal white-space from one observed line', () => {
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'metric-label', tagName: 'span', text: 'Avg cost / exchange',
            computedStyle: {
                display: 'block', whiteSpace: 'normal', fontSize: '13px', lineHeight: '18px',
            },
            rect: { x: 0, y: 0, width: 121.445, height: 18 }, children: [],
        }, 'now'), { sourceFile: '/metric', importedAt: 'now' });

        expect(native.root.style).toMatchObject({ whiteSpace: 'normal', lineHeight: 18 });
        expect(native.root.style).not.toHaveProperty('numberOfLines');
    });

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

    it('suppresses only the parent main-axis size on a fluid row item', () => {
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'shell', tagName: 'div',
            computedStyle: { display: 'flex', flexDirection: 'row' },
            rect: { x: 0, y: 0, width: 1200, height: 800 },
            children: [{
                sourceId: 'fluid-panel', tagName: 'main', children: [],
                computedStyle: {
                    display: 'flex', flexDirection: 'column', flexGrow: '1',
                    flexShrink: '1', flexBasis: '0%', width: '920px', height: '800px',
                },
                rect: { x: 280, y: 0, width: 920, height: 800 },
            }],
        }, 'now'), { sourceFile: '/fluid', importedAt: 'now' });
		const panel = (native.root.children as Record<string, any>[])[0];

		expect(panel.layout).not.toHaveProperty('widthMode');
		expect(panel.layout).not.toHaveProperty('width');
		expect(panel.layout).toMatchObject({ heightMode: 'fixed', height: 800 });
		expect(panel.style).not.toHaveProperty('width');
		expect(panel.style).toMatchObject({ height: 800 });
    });

    it('suppresses only the parent main-axis size on a fluid column item', () => {
        const ir = lowerObservedDom({
            sourceId: 'shell', tagName: 'div',
            computedStyle: { display: 'flex', flexDirection: 'column' },
            rect: { x: 0, y: 0, width: 600, height: 800 },
            children: [{
                sourceId: 'fluid-panel', tagName: 'main', children: [],
                computedStyle: {
                    display: 'flex', flexDirection: 'column', flexGrow: '1',
                    flexShrink: '1', flexBasis: '0%', width: '600px', height: '720px',
                },
                rect: { x: 0, y: 80, width: 600, height: 720 },
            }],
        }, 'now');
        const native = toNativeDesignIrV1(ir, { sourceFile: '/fluid-column', importedAt: 'now' });
        const panel = (native.root.children as Record<string, any>[])[0];

        expect(panel.layout).toMatchObject({ widthMode: 'fixed', width: 600 });
        expect(panel.layout).not.toHaveProperty('heightMode');
        expect(panel.layout).not.toHaveProperty('height');
        expect(panel.style).toMatchObject({ width: 600 });
        expect(panel.style).not.toHaveProperty('height');
    });

    it('does not freeze a computed viewport minimum on a viewport-filling node', () => {
        const native = toNativeDesignIrV1(lowerObservedDom({
            sourceId: 'html', tagName: 'html',
            computedStyle: { display: 'flex', flexDirection: 'column' },
            rect: { x: 0, y: 0, width: 1200, height: 800 },
            children: [{
                sourceId: 'body', tagName: 'body', children: [],
                computedStyle: {
                    display: 'flex', flexDirection: 'column', width: '1200px',
                    height: '800px', minHeight: '800px',
                },
                rect: { x: 0, y: 0, width: 1200, height: 800 },
            }],
        }, 'now'), { sourceFile: '/viewport', importedAt: 'now' });
        const body = (native.root.children as Record<string, any>[])[0];

        expect(body.layout).toMatchObject({ widthMode: 'fill', heightMode: 'fill' });
        expect(body.style).not.toHaveProperty('minHeight');
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

    it('carries source-proven overlay metadata into native materialization attributes', () => {
        const trigger = (expanded: string): ObservedDomNode => ({
            sourceId: 'usage-trigger', tagName: 'button',
            attributes: { 'aria-controls': 'usage-content-id', 'aria-expanded': expanded },
            computedStyle: { display: 'flex', position: 'absolute' },
            rect: { x: 100, y: 20, width: 40, height: 24 }, children: [],
        });
        const closed: ObservedDomNode = {
            sourceId: 'root', tagName: 'main', computedStyle: { display: 'flex' },
            rect: { x: 0, y: 0, width: 400, height: 300 }, children: [trigger('false')],
        };
        const open: ObservedDomNode = {
            ...closed, children: [trigger('true'), {
                sourceId: 'usage-content', tagName: 'div',
                attributes: { id: 'usage-content-id', role: 'dialog', 'data-slot': 'popover-content',
                    'data-side': 'bottom', 'data-align': 'end' },
                computedStyle: { display: 'flex', position: 'absolute' },
                rect: { x: 40, y: 48, width: 120, height: 80 }, children: [],
            }],
        };
        const report = extractObservedOverlayContracts(closed, open,
            [{ targetSourceId: 'main:1/button:1', event: 'click', openDelayMs: 90 }],
            [{ event: 'escape', closed: true, focusRestored: true }]);
        const projected = applyObservedOverlayContracts(lowerObservedDom(open, 'now'), report.contracts);
        const native = toNativeDesignIrV1(projected, { sourceFile: '/overlay', importedAt: 'now' });
        const [nativeTrigger, nativeContent] = native.root.children as Record<string, any>[];
        expect(nativeTrigger.attributes).toMatchObject({
            pulpOverlayKind: 'popover', pulpOverlayActivation: 'click',
            pulpOverlayAnchor: 'trigger',
            pulpOverlayOpenDelayMs: '90',
            pulpOverlayContentSourceId: 'usage-content', pulpOverlaySide: 'bottom',
            pulpOverlayAlign: 'end', pulpOverlayDismissEscape: 'true',
            pulpOverlayDismissOutsidePointer: 'false', pulpOverlayRestoreFocus: 'true',
        });
        expect(nativeContent.attributes).toMatchObject({
            pulpOverlayContent: 'true', pulpOverlayTriggerSourceId: 'usage-trigger',
            pulpOverlayHostFor: 'usage-trigger',
        });
    });

    it('preserves reviewed state-only value bindings through native materialization', () => {
        const ir = lowerObservedDom({
            sourceId: 'root', tagName: 'div', computedStyle: { display: 'flex' },
            rect: { x: 0, y: 0, width: 100, height: 100 }, children: [{
                sourceId: 'reasoning', tagName: 'p', text: 'Thinking',
                computedStyle: { display: 'block' },
                rect: { x: 0, y: 0, width: 100, height: 20 }, children: [],
            }],
        }, 'now');
        applySourceBindingPolicy(ir, { version: 1, rules: [{
            id: 'reasoning-text', match: { sourceId: 'reasoning' },
            attributes: { pulpValueKey: 'reasoning.text', pulpValueKind: 'markdown' },
        }] });
        const native = toNativeDesignIrV1(ir, { sourceFile: '/state', importedAt: 'now' });
        expect((native.root.children as Record<string, any>[])[0].attributes).toMatchObject({
            pulpValueKey: 'reasoning.text', pulpValueKind: 'markdown',
            pulpBindingPolicyRule: 'reasoning-text',
        });
    });
});
