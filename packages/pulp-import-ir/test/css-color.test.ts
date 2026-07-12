import { describe, expect, it } from 'vitest';
import { normalizeCssColor } from '../src/index.js';

describe('CSS Color 4 normalization', () => {
    it.each([
        ['#abc', '#aabbccff'],
        ['#abcd', '#aabbccdd'],
        ['rgb(255, 0, 128)', '#ff0080ff'],
        ['rgb(100% 0% 50% / 25%)', '#ff008040'],
        ['rgba(10, 20, 30, 0.5)', '#0a141e80'],
        ['color(srgb 0.5 0.25 1 / 0.4)', '#8040ff66'],
        ['oklab(1 0 0)', '#ffffffff'],
        ['oklab(0 0 0 / 50%)', '#00000080'],
        ['oklch(0.62796 0.25768 29.2339)', '#ff0000ff'],
        ['transparent', '#00000000'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizeCssColor(input)).toEqual({ original: input, value: expected });
    });

    it('diagnoses unsupported and malformed colors without substituting', () => {
        expect(normalizeCssColor('currentColor').diagnostic).toBe('css-color-unsupported');
        expect(normalizeCssColor('color(display-p3 1 0 0)').diagnostic).toBe('css-color-unsupported');
        expect(normalizeCssColor('rgb(nope 0 0)').diagnostic).toBe('css-color-invalid');
    });
});
