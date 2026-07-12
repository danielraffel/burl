import { describe, expect, it } from 'vitest';
import { parseObservedBackgroundGradient } from '../src/adapters/observed-dom/gradient.js';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed CSS gradients', () => {
    it.each([
        ['linear-gradient(to right, oklch(62% 0.2 250 / 75%), rgb(10 20 30 / 40%) 60%, #fff)', 'linear', 90],
        ['linear-gradient(225deg, #102030 10%, rgba(50, 60, 70, 0.5) 90%)', 'linear', 225],
        ['radial-gradient(circle at 25% bottom, oklch(55% 0.12 220 / 80%), transparent)', 'radial', undefined],
    ])('parses %s', (css, type, angle) => {
        const parsed = parseObservedBackgroundGradient(css);
        expect(parsed.diagnostic).toBeUndefined();
        expect(parsed.value).toMatchObject({ type, ...(angle === undefined ? {} : { angle }) });
        expect(parsed.value?.stops.every((stop) => /^#[0-9a-f]{8}$/.test(stop.color))).toBe(true);
    });

    it.each([
        ['linear-gradient(red, blue), url(texture.png)', 'gradient-multiple-layers'],
        ['conic-gradient(red, blue)', 'gradient-conic-unsupported'],
        ['url(texture.png)', 'gradient-image-unsupported'],
        ['linear-gradient(var(--start), blue)', 'gradient-unresolved-value'],
        ['linear-gradient(calc(20deg), red, blue)', 'gradient-unresolved-value'],
        ['linear-gradient(#ff0000 80%, #0000ff 20%)', 'gradient-syntax-invalid'],
        ['linear-gradient(currentColor, blue)', 'gradient-color-invalid'],
    ])('fails closed for %s', (css, code) => {
        expect(parseObservedBackgroundGradient(css)).toMatchObject({ diagnostic: { code, value: css } });
    });

    it('projects canonical gradient CSS and declares promoted-widget loss', () => {
        const source: ObservedDomNode = {
            sourceId: 'sidebar', tagName: 'div', children: [],
            computedStyle: { display: 'flex', backgroundImage: 'linear-gradient(to bottom, #123456, #abcdef)' },
            rect: { x: 0, y: 0, width: 160, height: 240 },
        };
        const ir = lowerObservedDom(source, 'now');
        expect(ir.confidence).toBe('PASS');
        const native = toNativeDesignIrV1(ir, { sourceFile: '/fixture', importedAt: 'now' });
        expect((native.root.style as Record<string, unknown>).backgroundGradient)
            .toBe('linear-gradient(180deg, #123456ff 0%, #abcdefff 100%)');

        const promoted = structuredClone(source);
        promoted.sourceId = 'button'; promoted.tagName = 'button';
        expect(lowerObservedDom(promoted, 'now')).toMatchObject({
            confidence: 'DIVERGE', meta: { css_gradient_loss_policy: 'native-widget-chrome-may-override-background' },
        });
    });
});
