export interface NormalizedCssColor {
    original: string;
    value?: `#${string}`;
    diagnostic?: 'css-color-unsupported' | 'css-color-invalid';
}

export function normalizeCssColor(input: string): NormalizedCssColor {
    const original = input;
    const value = input.trim().toLowerCase();
    if (value === 'transparent') return { original, value: '#00000000' };
    if (value.startsWith('#')) return normalizeHex(original, value);

    const fn = value.match(/^([a-z]+)\((.*)\)$/s);
    if (!fn) return { original, diagnostic: 'css-color-unsupported' };
    try {
        if (fn[1] === 'rgb' || fn[1] === 'rgba') return rgba(original, fn[2]);
        if (fn[1] === 'color') return colorFunction(original, fn[2]);
        if (fn[1] === 'oklab') return okLabFunction(original, fn[2], false);
        if (fn[1] === 'oklch') return okLabFunction(original, fn[2], true);
    } catch {
        return { original, diagnostic: 'css-color-invalid' };
    }
    return { original, diagnostic: 'css-color-unsupported' };
}

function normalizeHex(original: string, value: string): NormalizedCssColor {
    const body = value.slice(1);
    if (!/^[0-9a-f]+$/.test(body) || ![3, 4, 6, 8].includes(body.length)) {
        return { original, diagnostic: 'css-color-invalid' };
    }
    if (body.length === 3) return { original, value: `#${body.split('').map((x) => x + x).join('')}ff` };
    if (body.length === 4) return { original, value: `#${body.split('').map((x) => x + x).join('')}` };
    if (body.length === 6) return { original, value: `#${body}ff` };
    return { original, value: `#${body}` };
}

function rgba(original: string, body: string): NormalizedCssColor {
    const [channelsText, alphaText] = slash(body);
    const comma = channelsText.includes(',');
    const tokens = comma
        ? channelsText.split(',').map((part) => part.trim()).filter(Boolean)
        : channelsText.trim().split(/\s+/).filter(Boolean);
    let alphaValue = alphaText === undefined ? 1 : parseAlpha(alphaText);
    if (tokens.length === 4 && alphaText === undefined) alphaValue = parseAlpha(tokens.pop()!);
    if (tokens.length !== 3) throw new Error('rgb channel count');
    return encoded(original, tokens.map(rgbChannel) as [number, number, number], alphaValue);
}

function colorFunction(original: string, body: string): NormalizedCssColor {
    const [channelsText, alphaText] = slash(body);
    const tokens = channelsText.trim().split(/\s+/).filter(Boolean);
    if (tokens.shift() !== 'srgb' || tokens.length !== 3) {
        return { original, diagnostic: 'css-color-unsupported' };
    }
    const channels = tokens.map(unitInterval) as [number, number, number];
    return encoded(original, channels, alphaText === undefined ? 1 : parseAlpha(alphaText));
}

function okLabFunction(original: string, body: string, cylindrical: boolean): NormalizedCssColor {
    const [channelsText, alphaText] = slash(body);
    const tokens = channelsText.trim().split(/\s+/).filter(Boolean);
    if (tokens.length !== 3) throw new Error('oklab channel count');
    const l = percentScale(tokens[0], 1);
    let a: number;
    let b: number;
    if (cylindrical) {
        const c = percentScale(tokens[1], 0.4);
        const radians = angleDegrees(tokens[2]) * Math.PI / 180;
        a = c * Math.cos(radians);
        b = c * Math.sin(radians);
    } else {
        a = percentScale(tokens[1], 0.4);
        b = percentScale(tokens[2], 0.4);
    }
    return encoded(original, okLabToSrgb(l, a, b), alphaText === undefined ? 1 : parseAlpha(alphaText));
}

function okLabToSrgb(l: number, a: number, b: number): [number, number, number] {
    const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
    const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
    const sRoot = l - 0.0894841775 * a - 1.291485548 * b;
    const ll = lRoot ** 3;
    const mm = mRoot ** 3;
    const ss = sRoot ** 3;
    return [
        gamma(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
        gamma(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
        gamma(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss),
    ];
}

function gamma(value: number): number {
    const encodedValue = value <= 0.0031308
        ? 12.92 * value
        : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
    return clamp(encodedValue, 0, 1);
}

function encoded(
    original: string,
    channels: [number, number, number],
    alphaValue: number,
): NormalizedCssColor {
    const bytes = [...channels, alphaValue].map((value) =>
        Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0'));
    return { original, value: `#${bytes.join('')}` };
}

function slash(body: string): [string, string | undefined] {
    const parts = body.split('/');
    if (parts.length > 2) throw new Error('multiple alpha separators');
    return [parts[0].trim(), parts[1]?.trim()];
}

function rgbChannel(token: string): number {
    if (token.endsWith('%')) return clamp(Number(token.slice(0, -1)) / 100, 0, 1);
    return clamp(Number(token) / 255, 0, 1);
}

function unitInterval(token: string): number {
    return token.endsWith('%')
        ? clamp(Number(token.slice(0, -1)) / 100, 0, 1)
        : clamp(Number(token), 0, 1);
}

function parseAlpha(token: string): number {
    return unitInterval(token);
}

function percentScale(token: string, scale: number): number {
    return token.endsWith('%') ? Number(token.slice(0, -1)) / 100 * scale : Number(token);
}

function angleDegrees(token: string): number {
    if (token.endsWith('deg')) return Number(token.slice(0, -3));
    if (token.endsWith('grad')) return Number(token.slice(0, -4)) * 0.9;
    if (token.endsWith('rad')) return Number(token.slice(0, -3)) * 180 / Math.PI;
    if (token.endsWith('turn')) return Number(token.slice(0, -4)) * 360;
    return Number(token);
}

function clamp(value: number, low: number, high: number): number {
    if (!Number.isFinite(value)) throw new Error('non-finite channel');
    return Math.min(high, Math.max(low, value));
}
