import { describe, expect, test } from 'vitest';
import {
    resolveUniqueStableSourceId,
    stableAuthoredSourceSuffix,
} from '../src/stable-source-identity.js';

describe('stable source identity resolution', () => {
    test('resolves a volatile document prefix below the first authored identity', () => {
        const requested = 'dom/html-shape-old:0/body-shape-a:0/div-id-root:0/main-data-slot-content:0';
        const current = 'dom/html-shape-new:0/body-shape-b:0/div-id-root:0/main-data-slot-content:0';
        expect(stableAuthoredSourceSuffix(requested)).toBe(
            'div-id-root:0/main-data-slot-content:0',
        );
        expect(resolveUniqueStableSourceId(requested, [current])).toBe(current);
    });

    test('prefers an exact source identity even when a suffix is duplicated', () => {
        const exact = 'dom/html-shape-a:0/div-id-root:0/button-data-slot-trigger:0';
        const duplicate = 'dom/html-shape-b:0/div-id-root:0/button-data-slot-trigger:0';
        expect(resolveUniqueStableSourceId(exact, [exact, duplicate])).toBe(exact);
    });

    test('rejects an ambiguous authored suffix', () => {
        const requested = 'dom/html-shape-old:0/div-id-root:0/button-data-slot-trigger:0';
        expect(() => resolveUniqueStableSourceId(requested, [
            'dom/html-shape-a:0/div-id-root:0/button-data-slot-trigger:0',
            'dom/html-shape-b:0/div-id-root:0/button-data-slot-trigger:0',
        ])).toThrow(/resolved 2 candidates/);
    });

    test('rejects a missing authored suffix', () => {
        expect(() => resolveUniqueStableSourceId(
            'dom/html-shape-old:0/div-id-root:0/button-data-slot-missing:0',
            ['dom/html-shape-new:0/div-id-root:0/button-data-slot-present:0'],
        )).toThrow(/resolved 0 candidates/);
    });
});
