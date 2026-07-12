import { normalizeCssColor } from '../../css-color.js';
import type { Gradient } from '../../types.js';

export type GradientDiagnosticCode = 'gradient-multiple-layers' | 'gradient-conic-unsupported' |
    'gradient-image-unsupported' | 'gradient-unresolved-value' | 'gradient-syntax-invalid' |
    'gradient-color-invalid';
export interface GradientDiagnostic { code: GradientDiagnosticCode; value: string }

export function parseObservedBackgroundGradient(input: string | undefined):
        { value?: Gradient; diagnostic?: GradientDiagnostic } {
    if (!input || input === 'none') return {};
    const value = input.trim();
    if (/\b(?:var|calc)\(/i.test(value)) return problem('gradient-unresolved-value', value);
    if (/^conic-gradient\(/i.test(value)) return problem('gradient-conic-unsupported', value);
    if (/^(?:url|image|image-set|cross-fade)\(/i.test(value)) return problem('gradient-image-unsupported', value);
    const close = matchingClose(value);
    if (close < 0) return problem('gradient-syntax-invalid', value);
    const trailing = value.slice(close + 1).trim();
    if (trailing.startsWith(',')) return problem('gradient-multiple-layers', value);
    if (trailing) return problem('gradient-syntax-invalid', value);
    if (/^linear-gradient\(/i.test(value)) return linear(value);
    if (/^radial-gradient\(/i.test(value)) return radial(value);
    return problem('gradient-image-unsupported', value);
}

export function parseObservedBackgroundLayers(input: string | undefined):
        { value?: Gradient[]; diagnostic?: GradientDiagnostic } {
    if (!input || input === 'none') return { value: [] };
    const layers = split(input);
    const result: Gradient[] = [];
    for (const layer of layers) {
        const parsed = parseLayer(layer);
        if (!parsed.value) return { diagnostic: parsed.diagnostic! };
        result.push(parsed.value);
    }
    return { value: result };
}

function parseLayer(value: string): { value?: Gradient; diagnostic?: GradientDiagnostic } {
    if (/^linear-gradient\(/i.test(value)) return linear(value);
    if (/^radial-gradient\(/i.test(value)) return radial(value);
    return problem('gradient-image-unsupported', value);
}

function linear(input: string): { value?: Gradient; diagnostic?: GradientDiagnostic } {
    const parts = split(inner(input));
    if (parts.length < 2) return problem('gradient-syntax-invalid', input);
    let angle = 180;
    const prefix = parts[0].toLowerCase();
    if (/^-?(?:\d+\.?\d*|\.\d+)deg$/.test(prefix)) {
        angle = Number(prefix.slice(0, -3)); parts.shift();
    } else if (prefix.startsWith('to ')) {
        const map: Record<string, number> = {
            'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
            'to top right': 45, 'to right top': 45, 'to bottom right': 135,
            'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225,
            'to top left': 315, 'to left top': 315,
        };
        if (map[prefix] === undefined) return problem('gradient-syntax-invalid', input);
        angle = map[prefix]; parts.shift();
    }
    const parsed = stops(parts, input);
    if (!parsed.value) return { diagnostic: parsed.diagnostic! };
    const css = `linear-gradient(${angle}deg, ${serialize(parsed.value)})`;
    return { value: { type: 'linear', angle, stops: parsed.value, css } };
}

function radial(input: string): { value?: Gradient; diagnostic?: GradientDiagnostic } {
    const parts = split(inner(input));
    if (parts.length < 2) return problem('gradient-syntax-invalid', input);
    let shape: 'circle' | 'ellipse' = 'ellipse', centerX = 0.5, centerY = 0.5;
    const prefix = parts[0].toLowerCase();
    if (/^(?:circle|ellipse|at\b)/.test(prefix)) {
        if (!/^(?:(?:circle|ellipse)(?:\s+at\s+\S+\s+\S+)?|at\s+\S+\s+\S+)$/.test(prefix))
            return problem('gradient-syntax-invalid', input);
        if (prefix.startsWith('circle')) shape = 'circle';
        const at = prefix.indexOf('at ');
        if (at >= 0) {
            const coordinates = prefix.slice(at + 3).trim().split(/\s+/);
            const x = position(coordinates[0], true), y = position(coordinates[1], false);
            if (coordinates.length !== 2 || x === undefined || y === undefined)
                return problem('gradient-syntax-invalid', input);
            centerX = x; centerY = y;
        }
        parts.shift();
    }
    const parsed = stops(parts, input);
    if (!parsed.value) return { diagnostic: parsed.diagnostic! };
    const css = `radial-gradient(${shape} at ${centerX * 100}% ${centerY * 100}%, ${serialize(parsed.value)})`;
    return { value: { type: 'radial', shape, centerX, centerY, stops: parsed.value, css } };
}

function stops(parts: string[], input: string): { value?: Gradient['stops']; diagnostic?: GradientDiagnostic } {
    if (parts.length < 2) return problem('gradient-syntax-invalid', input);
    const result: { color: string; offset?: number; offsetPixels?: number }[] = [];
    for (const part of parts) {
        const match = part.trim().match(/^(.*?)(?:\s+(-?(?:\d+\.?\d*|\.\d+)%|calc\(.*\)))?$/);
        if (!match) return problem('gradient-syntax-invalid', input);
        const color = normalizeCssColor(match[1].trim());
        if (!color.value || color.diagnostic) return problem('gradient-color-invalid', input);
        let offset: number | undefined, offsetPixels = 0;
        if (match[2]?.startsWith('calc(')) {
            const calc = match[2].match(/^calc\(\s*(-?(?:\d+\.?\d*|\.\d+))%\s*([+-])\s*(\d+\.?\d*|\.\d+)px\s*\)$/);
            if (!calc) return problem('gradient-unresolved-value', input);
            offset = Number(calc[1]) / 100;
            offsetPixels = Number(calc[3]) * (calc[2] === '-' ? -1 : 1);
        } else if (match[2] !== undefined) {
            offset = Number(match[2].slice(0, -1)) / 100;
        }
        if (offset !== undefined && (offset < 0 || offset > 1)) return problem('gradient-syntax-invalid', input);
        result.push({ color: color.value, offset, offsetPixels });
    }
    if (result[0].offset === undefined) result[0].offset = 0;
    if (result[result.length - 1].offset === undefined) result[result.length - 1].offset = 1;
    for (let start = 0; start < result.length - 1;) {
        let end = start + 1; while (end < result.length && result[end].offset === undefined) ++end;
        const from = result[start].offset!, to = result[end].offset!;
        for (let index = start + 1; index < end; ++index)
            result[index].offset = from + (to - from) * (index - start) / (end - start);
        start = end;
    }
    if (result.some((item, index) => index > 0 && item.offset! < result[index - 1].offset!))
        return problem('gradient-syntax-invalid', input);
    return { value: result.map((item) => ({
        color: item.color, offset: item.offset!, ...(item.offsetPixels ? { offsetPixels: item.offsetPixels } : {}),
    })) };
}

const serialize = (value: Gradient['stops']) => value.map((s) => {
    const position = s.offsetPixels
        ? `calc(${s.offset * 100}% ${s.offsetPixels < 0 ? '-' : '+'} ${Math.abs(s.offsetPixels)}px)`
        : `${s.offset * 100}%`;
    return `${s.color} ${position}`;
}).join(', ');
const inner = (value: string) => value.slice(value.indexOf('(') + 1, -1);
function matchingClose(value: string): number {
    let depth = 0;
    for (let index = value.indexOf('('); index < value.length; ++index) {
        if (value[index] === '(') ++depth;
        else if (value[index] === ')' && --depth === 0) return index;
    }
    return -1;
}
function split(value: string): string[] {
    const out: string[] = []; let current = '', depth = 0;
    for (const char of value) {
        if (char === '(') ++depth; else if (char === ')') --depth;
        if (char === ',' && depth === 0) { out.push(current.trim()); current = ''; } else current += char;
    }
    if (current.trim()) out.push(current.trim()); return out;
}
function position(value: string | undefined, horizontal: boolean): number | undefined {
    if (!value) return undefined;
    const keywords: Record<string, number> = horizontal
        ? { left: 0, center: 0.5, right: 1 } : { top: 0, center: 0.5, bottom: 1 };
    if (keywords[value] !== undefined) return keywords[value];
    if (!/^(?:\d+\.?\d*|\.\d+)%$/.test(value)) return undefined;
    const result = Number(value.slice(0, -1)) / 100;
    return result >= 0 && result <= 1 ? result : undefined;
}
function problem(code: GradientDiagnosticCode, value: string): { diagnostic: GradientDiagnostic } {
    return { diagnostic: { code, value } };
}
