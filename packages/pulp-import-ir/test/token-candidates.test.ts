import { describe, expect, it } from 'vitest';
import {
    assertRenderNeutral,
    extractTokenCandidates,
    promoteTokenCandidates,
    reconcileTokenAdherence,
    rewritePromotedTokens,
    serializeTokenCandidates,
    toNativeDesignIrV1,
    type IRNode,
    type TokenScenario,
} from '../src/index.js';

function node(anchor: string, background: string, gap: number): IRNode {
    return {
        tag: 'View',
        stable_anchor_id: anchor,
        source_node_id: anchor,
        layout: { gap, paddingTop: 8 },
        paint: { backgroundColor: background, borderColor: '#20242a', borderRadius: 6 },
        text: { text: 'Neutral fixture', fontFamily: 'Inter', fontSize: 14, fontWeight: 500 },
        children: [],
        provenance: { adapter: 'neutral-fixture', version: '1.0.0', ts: '2026-01-01T00:00:00Z' },
        raw_source: { kind: 'unknown', payload: { background } },
        confidence: 'PASS',
    };
}

function fixtures(): TokenScenario[] {
    return [
        { scenario: 'dialog', state: 'rest', root: node('dialog', '#101418', 8) },
        { scenario: 'dialog', state: 'hover', root: node('dialog', '#111519', 9) },
        { scenario: 'toolbar', state: 'rest', root: node('toolbar', 'rgb(16 20 24)', 8) },
    ];
}

describe('token candidate inference and promotion', () => {
    it('clusters only exact normalized values and preserves provenance and distributions', () => {
        const first = extractTokenCandidates(fixtures());
        const second = extractTokenCandidates([...fixtures()].reverse());
        expect(second).toEqual(first);
        expect(serializeTokenCandidates(second)).toBe(serializeTokenCandidates(first));
        const surface = first.candidates.find((candidate) => candidate.value === '#101418ff');
        expect(surface).toMatchObject({ kind: 'color', usageCount: 2, roles: ['bg'] });
        expect(surface?.sampleAnchors).toEqual(['dialog', 'toolbar']);
        expect(surface?.observations[0]).toMatchObject({
            sourceAdapter: 'neutral-fixture',
            sourceVersion: '1.0.0',
            role: 'bg',
        });
        expect(first.candidates.some((candidate) => candidate.value === '#111519ff')).toBe(true);
        const hover = first.candidates.find((candidate) => candidate.value === '#111519ff')!;
        const perceptual = first.mergeSuggestions.find((suggestion) =>
            suggestion.candidateIds.includes(surface!.id) && suggestion.candidateIds.includes(hover.id));
        expect(perceptual?.reason).toMatch(/^OKLab DeltaE \d+\.\d{4} is below 2$/);
        expect(first.mergeSuggestions.some((suggestion) => suggestion.kind === 'dimension')).toBe(true);
    });

    it('keeps unsupported colors literal and emits deterministic normalization diagnostics', () => {
        const root = node('unsupported-color', 'currentColor', 8);
        const document = extractTokenCandidates([{ scenario: 'unsupported', state: 'rest', root }]);
        expect(document.candidates.some((candidate) => candidate.value === 'currentColor')).toBe(true);
        expect(document.diagnostics).toEqual([{
            kind: 'color-normalization',
            code: 'css-color-unsupported',
            observationId: 'unsupported|rest|unsupported-color|paint.backgroundColor',
            value: 'currentColor',
        }]);
    });

    it('records explicit review, rewrites exact matches, and is mechanically render-neutral', () => {
        const original = fixtures();
        const candidates = extractTokenCandidates(original);
        const surface = candidates.candidates.find((candidate) => candidate.value === '#101418ff')!;
        const typography = candidates.candidates.find((candidate) => candidate.kind === 'typography')!;
        const promotion = promoteTokenCandidates(candidates, [
            {
                candidateId: surface.id,
                tokenName: 'color.bg.surface',
                reviewedBy: 'fixture-reviewer',
                reviewedAt: '2026-01-02T00:00:00Z',
                mergeDecisions: ['kept #111519 distinct'],
            },
            {
                candidateId: typography.id,
                tokenName: 'typography.body',
                reviewedBy: 'fixture-reviewer',
                reviewedAt: '2026-01-02T00:00:00Z',
            },
        ]);
        expect(promotion.tokens['color.bg.surface'].$value).toBe('#101418ff');
        expect(promotion.promotions[0].provenance).toMatchObject({
            kind: 'promoted-candidate',
            reviewedBy: 'fixture-reviewer',
        });
        const rewritten = rewritePromotedTokens(original, promotion);
        expect(rewritten[0].root.paint?.backgroundColor).toBeUndefined();
        expect(rewritten[0].root.token_refs?.['paint.backgroundColor']).toBe('{color.bg.surface}');
        expect(rewritten[0].root.text?.fontFamily).toBeUndefined();
        expect(rewritten[0].root.token_refs?.['text.typography']).toBe('{typography.body}');
        const native = toNativeDesignIrV1(rewritten[0].root, {
            sourceFile: '/neutral/fixture', importedAt: '2026-01-02T00:00:00Z',
        });
        expect(native.root.token_refs).toEqual(rewritten[0].root.token_refs);
        expect(rewritten[1].root.paint?.backgroundColor).toBe('#111519');
        expect(rewritten[0].root.raw_source).toEqual(original[0].root.raw_source);
        expect(() => assertRenderNeutral(original, rewritten, promotion)).not.toThrow();
        const adherence = reconcileTokenAdherence(rewritten, candidates, promotion);
        expect(adherence.clean).toBe(true);
        expect(adherence.remainingLiteralObservationIds).toEqual(adherence.expectedUnpromotedObservationIds);
    });

    it('rejects implicit or ambiguous promotion decisions', () => {
        const candidates = extractTokenCandidates(fixtures());
        expect(() => promoteTokenCandidates(candidates, [{
            candidateId: 'color:missing', tokenName: 'color.bg.missing',
            reviewedBy: 'reviewer', reviewedAt: '2026-01-02T00:00:00Z',
        }])).toThrow(/unknown token candidate/);
        const candidateId = candidates.candidates[0].id;
        expect(() => promoteTokenCandidates(candidates, [
            { candidateId, tokenName: 'color.same', reviewedBy: 'a', reviewedAt: 't' },
            { candidateId, tokenName: 'color.same', reviewedBy: 'b', reviewedAt: 't' },
        ])).toThrow(/duplicate token name/);
    });
});
