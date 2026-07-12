import type { IRNode, TokenRef } from './types.js';
import { normalizeCssColor } from './css-color.js';

export type TokenCandidateKind = 'color' | 'dimension' | 'typography' | 'shadow';

export interface TokenScenario {
    scenario: string;
    state: string;
    root: IRNode;
}

export interface TokenObservation {
    id: string;
    scenario: string;
    state: string;
    stableAnchor: string;
    sourceAdapter: string;
    sourceVersion: string;
    role: string;
    path: string;
    value: unknown;
}

export interface TokenCandidate {
    id: string;
    kind: TokenCandidateKind;
    value: unknown;
    usageCount: number;
    roles: string[];
    sampleAnchors: string[];
    distribution: { scenario: string; state: string; count: number }[];
    observations: TokenObservation[];
    suggestedName: string;
}

export interface TokenMergeSuggestion {
    kind: TokenCandidateKind;
    candidateIds: [string, string];
    reason: string;
}

export interface TokenCandidateDocument {
    schemaVersion: 1;
    source: 'lowered-ir-scenarios';
    candidates: TokenCandidate[];
    mergeSuggestions: TokenMergeSuggestion[];
    diagnostics: TokenCandidateDiagnostic[];
}

export interface TokenCandidateDiagnostic {
    kind: 'color-normalization';
    code: 'css-color-unsupported' | 'css-color-invalid';
    observationId: string;
    value: string;
}

export interface TokenPromotionDecision {
    candidateId: string;
    tokenName: string;
    reviewedBy: string;
    reviewedAt: string;
    mergeDecisions?: string[];
}

export interface PromotedToken {
    name: string;
    kind: TokenCandidateKind;
    value: unknown;
    provenance: {
        kind: 'promoted-candidate';
        candidateId: string;
        sourceValues: unknown[];
        reviewedBy: string;
        reviewedAt: string;
        mergeDecisions: string[];
    };
}

export interface AuthoredTokenPromotionDocument {
    schemaVersion: 1;
    tokens: Record<string, { $type: string; $value: unknown; $extensions: Record<string, unknown> }>;
    promotions: PromotedToken[];
}

interface LiteralLocation {
    kind: TokenCandidateKind;
    role: string;
    path: string;
    value: unknown;
}

const paintDimensions = new Set([
    'borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius',
    'borderBottomRightRadius',
]);
const layoutDimensions = new Set([
    'gap', 'rowGap', 'columnGap', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom',
    'paddingLeft', 'paddingHorizontal', 'paddingVertical', 'margin', 'marginTop', 'marginRight',
    'marginBottom', 'marginLeft', 'marginHorizontal', 'marginVertical',
]);

export function extractTokenCandidates(scenarios: TokenScenario[]): TokenCandidateDocument {
    const observations: TokenObservation[] = [];
    const diagnostics: TokenCandidateDiagnostic[] = [];
    for (const scenario of [...scenarios].sort(compareScenario)) {
        walk(scenario.root, (node) => {
            for (const literal of literals(node)) {
                const identity = `${scenario.scenario}|${scenario.state}|${node.stable_anchor_id}|${literal.path}`;
                const normalized = normalize(literal.kind, literal.value);
                const value = normalized.value;
                if (normalized.diagnostic && typeof literal.value === 'string') diagnostics.push({
                    kind: 'color-normalization',
                    code: normalized.diagnostic,
                    observationId: identity,
                    value: literal.value,
                });
                observations.push({
                    id: identity,
                    scenario: scenario.scenario,
                    state: scenario.state,
                    stableAnchor: node.stable_anchor_id,
                    sourceAdapter: node.provenance.adapter,
                    sourceVersion: node.provenance.version,
                    role: literal.role,
                    path: literal.path,
                    value,
                });
            }
        });
    }
    observations.sort((a, b) => a.id.localeCompare(b.id));
    const groups = new Map<string, TokenObservation[]>();
    for (const observation of observations) {
        const kind = kindForPath(observation.path);
        const key = `${kind}:${stableJson(observation.value)}`;
        const group = groups.get(key) ?? [];
        group.push(observation);
        groups.set(key, group);
    }
    const candidates = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
        const kind = key.slice(0, key.indexOf(':')) as TokenCandidateKind;
        const value = group[0].value;
        const distribution = new Map<string, number>();
        for (const item of group) {
            const distributionKey = `${item.scenario}\0${item.state}`;
            distribution.set(distributionKey, (distribution.get(distributionKey) ?? 0) + 1);
        }
        return {
            id: candidateId(kind, value),
            kind,
            value,
            usageCount: group.length,
            roles: unique(group.map((item) => item.role)),
            sampleAnchors: unique(group.map((item) => item.stableAnchor)).slice(0, 8),
            distribution: [...distribution].sort(([a], [b]) => a.localeCompare(b)).map(([entry, count]) => {
                const [scenario, state] = entry.split('\0');
                return { scenario, state, count };
            }),
            observations: group,
            suggestedName: suggestedName(kind, group[0].role, value),
        };
    });
    return {
        schemaVersion: 1,
        source: 'lowered-ir-scenarios',
        candidates,
        mergeSuggestions: suggestions(candidates),
        diagnostics: diagnostics.sort((a, b) => a.observationId.localeCompare(b.observationId)),
    };
}

export function serializeTokenCandidates(document: TokenCandidateDocument): string {
    return `${JSON.stringify(document, null, 2)}\n`;
}

export function promoteTokenCandidates(
    document: TokenCandidateDocument,
    decisions: TokenPromotionDecision[],
): AuthoredTokenPromotionDocument {
    const candidates = new Map(document.candidates.map((candidate) => [candidate.id, candidate]));
    const names = new Set<string>();
    const promotions = [...decisions].sort((a, b) => a.tokenName.localeCompare(b.tokenName)).map((decision) => {
        const candidate = candidates.get(decision.candidateId);
        if (!candidate) throw new Error(`unknown token candidate: ${decision.candidateId}`);
        if (!/^[a-z][a-z0-9.-]*$/.test(decision.tokenName) || names.has(decision.tokenName)) {
            throw new Error(`invalid or duplicate token name: ${decision.tokenName}`);
        }
        names.add(decision.tokenName);
        return {
            name: decision.tokenName,
            kind: candidate.kind,
            value: candidate.value,
            provenance: {
                kind: 'promoted-candidate' as const,
                candidateId: candidate.id,
                sourceValues: [candidate.value],
                reviewedBy: decision.reviewedBy,
                reviewedAt: decision.reviewedAt,
                mergeDecisions: [...(decision.mergeDecisions ?? [])].sort(),
            },
        };
    });
    return {
        schemaVersion: 1,
        tokens: Object.fromEntries(promotions.map((item) => [item.name, {
            $type: dtcgType(item.kind),
            $value: item.value,
            $extensions: { 'com.pulp.promotion': item.provenance },
        }])),
        promotions,
    };
}

export function rewritePromotedTokens(
    scenarios: TokenScenario[],
    promotion: AuthoredTokenPromotionDocument,
): TokenScenario[] {
    const values = new Map(promotion.promotions.map((item) => [
        `${item.kind}:${stableJson(item.value)}`,
        `{${item.name}}` as TokenRef,
    ]));
    return scenarios.map((scenario) => ({
        ...scenario,
        root: rewriteNode(structuredClone(scenario.root), values),
    }));
}

export function resolvePromotedTokens(
    scenarios: TokenScenario[],
    promotion: AuthoredTokenPromotionDocument,
): TokenScenario[] {
    const values = new Map(promotion.promotions.map((item) => [`{${item.name}}`, item.value]));
    return scenarios.map((scenario) => ({
        ...scenario,
        root: resolveNode(structuredClone(scenario.root), values),
    }));
}

export function assertRenderNeutral(
    before: TokenScenario[],
    after: TokenScenario[],
    promotion: AuthoredTokenPromotionDocument,
): void {
    const resolved = resolvePromotedTokens(after, promotion);
    if (stableJson(before.map(renderSignature)) !== stableJson(resolved.map(renderSignature))) {
        throw new Error('token promotion changed render-bearing IR');
    }
}

export function reconcileTokenAdherence(
    rewritten: TokenScenario[],
    originalCandidates: TokenCandidateDocument,
    promotion: AuthoredTokenPromotionDocument,
): { clean: boolean; remainingLiteralObservationIds: string[]; expectedUnpromotedObservationIds: string[] } {
    const remaining = extractTokenCandidates(rewritten).candidates.flatMap((candidate) =>
        candidate.observations.map((item) => item.id)).sort();
    const promoted = new Set(promotion.promotions.map((item) => item.provenance.candidateId));
    const expected = originalCandidates.candidates.filter((candidate) => !promoted.has(candidate.id))
        .flatMap((candidate) => candidate.observations.map((item) => item.id)).sort();
    return {
        clean: stableJson(remaining) === stableJson(expected),
        remainingLiteralObservationIds: remaining,
        expectedUnpromotedObservationIds: expected,
    };
}

function walk(node: IRNode, visit: (node: IRNode) => void): void {
    visit(node);
    for (const child of node.children) walk(child, visit);
}

function literals(node: IRNode): LiteralLocation[] {
    const out: LiteralLocation[] = [];
    const paint = node.paint as Record<string, unknown> | undefined;
    if (paint) {
        for (const [key, value] of Object.entries(paint)) {
            if (key.endsWith('Color') && literal(value)) out.push({ kind: 'color', role: colorRole(key), path: `paint.${key}`, value });
            if (paintDimensions.has(key) && literal(value)) out.push({ kind: 'dimension', role: dimensionRole(key), path: `paint.${key}`, value });
        }
        const shadows = paint.boxShadow;
        if (Array.isArray(shadows)) shadows.forEach((value, index) => {
            if (value !== undefined) out.push({ kind: 'shadow', role: 'shadow', path: `paint.boxShadow.${index}`, value });
        });
        const gradient = paint.backgroundGradient as { stops?: { color: unknown }[] } | undefined;
        gradient?.stops?.forEach((stop, index) => {
            if (literal(stop.color)) out.push({ kind: 'color', role: 'background', path: `paint.backgroundGradient.stops.${index}.color`, value: stop.color });
        });
    }
    const layout = node.layout as Record<string, unknown> | undefined;
    if (layout) for (const [key, value] of Object.entries(layout)) {
        if (layoutDimensions.has(key) && literal(value)) out.push({ kind: 'dimension', role: dimensionRole(key), path: `layout.${key}`, value });
    }
    const text = node.text;
    if (text) {
        const tuple = Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing']
            .filter((key) => text[key as keyof typeof text] !== undefined)
            .map((key) => [key, text[key as keyof typeof text]]));
        if (Object.keys(tuple).length > 0 && Object.values(tuple).every(literal)) {
            out.push({ kind: 'typography', role: 'text', path: 'text.typography', value: tuple });
        }
    }
    return out;
}

function rewriteNode(node: IRNode, values: Map<string, TokenRef>): IRNode {
    for (const item of literals(node)) {
        const ref = values.get(`${item.kind}:${stableJson(normalize(item.kind, item.value).value)}`);
        if (!ref) continue;
        node.token_refs ??= {};
        node.token_refs[item.path] = ref;
        deleteLiteral(node, item.path);
    }
    node.children = node.children.map((child) => rewriteNode(child, values));
    return node;
}

function resolveNode(node: IRNode, values: Map<string, unknown>): IRNode {
    for (const [path, ref] of Object.entries(node.token_refs ?? {})) {
        const value = values.get(ref);
        if (value === undefined) throw new Error(`unresolved promoted token: ${ref}`);
        restoreLiteral(node, path, structuredClone(value));
    }
    delete node.token_refs;
    replaceRefs(node as unknown as Record<string, unknown>, values);
    node.children = node.children.map((child) => resolveNode(child, values));
    return node;
}

function replaceRefs(value: unknown, tokens: Map<string, unknown>): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' && tokens.has(child)) (value as Record<string, unknown>)[key] = structuredClone(tokens.get(child));
        else replaceRefs(child, tokens);
    }
}

function setPath(root: Record<string, unknown>, path: string, value: unknown, create = false): void {
    if (value === undefined) return;
    const parts = path.split('.');
    let target = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        let next = target[part];
        if ((!next || typeof next !== 'object') && create) {
            next = /^\d+$/.test(parts[index + 1] ?? '') ? [] : {};
            target[part] = next;
        }
        if (!next || typeof next !== 'object') return;
        target = next as Record<string, unknown>;
    }
    target[parts.at(-1)!] = value;
}

function deletePath(root: Record<string, unknown>, path: string): void {
    const parts = path.split('.');
    let target = root;
    for (const part of parts.slice(0, -1)) {
        const next = target[part];
        if (!next || typeof next !== 'object') return;
        target = next as Record<string, unknown>;
    }
    if (Array.isArray(target)) target[Number(parts.at(-1))] = undefined;
    else delete target[parts.at(-1)!];
}

function deleteLiteral(node: IRNode, path: string): void {
    if (path === 'text.typography') {
        for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing']) {
            if (node.text) delete (node.text as Record<string, unknown>)[key];
        }
        return;
    }
    deletePath(node as unknown as Record<string, unknown>, path);
}

function restoreLiteral(node: IRNode, path: string, value: unknown): void {
    if (path === 'text.typography') {
        node.text ??= {};
        Object.assign(node.text, value);
        return;
    }
    setPath(node as unknown as Record<string, unknown>, path, value, true);
}

function renderSignature(scenario: TokenScenario): unknown {
    const project = (node: IRNode): unknown => ({
        tag: node.tag,
        layout: node.layout,
        paint: canonicalPaintValue(node.paint),
        text: node.text,
        children: node.children.map(project),
    });
    return { scenario: scenario.scenario, state: scenario.state, root: project(scenario.root) };
}

function canonicalPaintValue(value: unknown): unknown {
    if (typeof value === 'string') return normalizeCssColor(value).value ?? value;
    if (Array.isArray(value)) return value.map(canonicalPaintValue);
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, canonicalPaintValue(child)]),
    );
    return value;
}

function normalize(
    kind: TokenCandidateKind,
    value: unknown,
): { value: unknown; diagnostic?: 'css-color-unsupported' | 'css-color-invalid' } {
    if (kind === 'color' && typeof value === 'string') {
        const result = normalizeCssColor(value);
        return result.value
            ? { value: result.value }
            : { value, diagnostic: result.diagnostic };
    }
    return { value: JSON.parse(stableJson(value)) };
}

function literal(value: unknown): boolean {
    return typeof value !== 'string' || !/^\{[^{}]+\}$/.test(value);
}

function kindForPath(path: string): TokenCandidateKind {
    if (path === 'text.typography') return 'typography';
    if (path.startsWith('paint.boxShadow.')) return 'shadow';
    if (path.endsWith('Color') || path.includes('.stops.')) return 'color';
    return 'dimension';
}

function candidateId(kind: TokenCandidateKind, value: unknown): string {
    return `${kind}:${fnv1a(stableJson(value))}`;
}

function fnv1a(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
    return JSON.stringify(value);
}

function suggestions(candidates: TokenCandidate[]): TokenMergeSuggestion[] {
    const out: TokenMergeSuggestion[] = [];
    for (let left = 0; left < candidates.length; left += 1) for (let right = left + 1; right < candidates.length; right += 1) {
        const a = candidates[left];
        const b = candidates[right];
        if (a.kind !== b.kind) continue;
        if (a.kind === 'dimension' && typeof a.value === 'number' && typeof b.value === 'number' && Math.abs(a.value - b.value) <= 1) {
            out.push({ kind: a.kind, candidateIds: [a.id, b.id], reason: 'values differ by at most 1px' });
        }
        const delta = a.kind === 'color' && typeof a.value === 'string' && typeof b.value === 'string'
            ? okLabDeltaE(a.value, b.value)
            : Number.POSITIVE_INFINITY;
        if (delta < 2) {
            out.push({ kind: a.kind, candidateIds: [a.id, b.id], reason: `OKLab DeltaE ${delta.toFixed(4)} is below 2` });
        }
    }
    return out;
}

function okLabDeltaE(a: string, b: string): number {
    const left = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(a);
    const right = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(b);
    if (!left || !right) return Number.POSITIVE_INFINITY;
    if (left[2].toLowerCase() !== right[2].toLowerCase()) return Number.POSITIVE_INFINITY;
    const aa = hexToOkLab(left[1]);
    const bb = hexToOkLab(right[1]);
    return Math.sqrt(aa.reduce((sum, channel, index) => sum + (channel - bb[index]) ** 2, 0)) * 100;
}

function hexToOkLab(hex: string): [number, number, number] {
    const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    const l = 0.4122214708 * channels[0] + 0.5363325363 * channels[1] + 0.0514459929 * channels[2];
    const m = 0.2119034982 * channels[0] + 0.6806995451 * channels[1] + 0.1073969566 * channels[2];
    const s = 0.0883024619 * channels[0] + 0.2817188376 * channels[1] + 0.6299787005 * channels[2];
    const ll = Math.cbrt(l);
    const mm = Math.cbrt(m);
    const ss = Math.cbrt(s);
    return [
        0.2104542553 * ll + 0.793617785 * mm - 0.0040720468 * ss,
        1.9779984951 * ll - 2.428592205 * mm + 0.4505937099 * ss,
        0.0259040371 * ll + 0.7827717662 * mm - 0.808675766 * ss,
    ];
}

function suggestedName(kind: TokenCandidateKind, role: string, value: unknown): string {
    const suffix = fnv1a(stableJson(value)).slice(0, 6);
    if (kind === 'color') return `color.${role}.${suffix}`;
    if (kind === 'dimension') return `${role}.${suffix}`;
    return `${kind}.${role}.${suffix}`;
}

function dtcgType(kind: TokenCandidateKind): string {
    if (kind === 'dimension') return 'dimension';
    return kind;
}

function colorRole(key: string): string {
    if (key.startsWith('background')) return 'bg';
    if (key.startsWith('border')) return 'border';
    return 'text';
}

function dimensionRole(key: string): string {
    if (key.includes('Radius')) return 'radius';
    if (key.includes('border')) return 'border';
    return 'space';
}

function unique(values: string[]): string[] {
    return [...new Set(values)].sort();
}

function compareScenario(a: TokenScenario, b: TokenScenario): number {
    return `${a.scenario}\0${a.state}`.localeCompare(`${b.scenario}\0${b.state}`);
}
