import { describe, expect, test } from 'vitest';
import { captureCohortKey } from '../src/capture-cohort';

const legacy = { schema: 'capture-v1', page: { url: 'http://localhost/app' }, policy: {
    sourceRevision: 'abc', clock: '2026-01-01T00:00:00Z',
    viewport: { width: 800, height: 600, deviceScaleFactor: 2 }, reload: true,
    clearStorage: true, animations: 'disabled', transitions: 'disabled',
    network: 'source-only', hostServices: 'recording-fake',
} };

describe('capture cohort identity', () => {
    test('prefers the producer-owned cohort hash', () => {
        const a = { ...legacy, policy: { ...legacy.policy, cohortSha256: 'a'.repeat(64),
            runtimeState: { mode: 'explicit-storage-seed', sha256: '1'.repeat(64) } } };
        const b = { ...legacy, policy: { ...legacy.policy, cohortSha256: 'b'.repeat(64),
            runtimeState: { mode: 'explicit-storage-seed', sha256: '2'.repeat(64) } } };
        expect(captureCohortKey(a)).not.toBe(captureCohortKey(b));
    });
    test('legacy receipts compare deterministically but cannot claim runtime state', () => {
        expect(captureCohortKey(legacy)).toBe(captureCohortKey(structuredClone(legacy)));
        expect(() => captureCohortKey({ ...legacy, policy: { ...legacy.policy,
            runtimeState: { mode: 'explicit-storage-seed' } } })).toThrow('without a cohortSha256');
    });
    test('viewport dimensions are optional while device scale remains cohort-bound', () => {
        const wider = { ...legacy, policy: { ...legacy.policy,
            viewport: { width: 1200, height: 800, deviceScaleFactor: 2 } } };
        expect(captureCohortKey(legacy)).toBe(captureCohortKey(wider));
        expect(captureCohortKey(legacy, { includeViewport: true }))
            .not.toBe(captureCohortKey(wider, { includeViewport: true }));
    });
    test('comparison scope remains binding for producer-hashed receipts', () => {
        const hashed = { ...legacy, policy: { ...legacy.policy, cohortSha256: 'a'.repeat(64) } };
        const wider = { ...hashed, policy: { ...hashed.policy,
            viewport: { width: 1200, height: 800, deviceScaleFactor: 2 } } };
        const otherPage = { ...hashed, page: { url: 'http://localhost/other' } };
        expect(captureCohortKey(hashed)).not.toBe(captureCohortKey(otherPage));
        expect(captureCohortKey(hashed, { includeViewport: true }))
            .not.toBe(captureCohortKey(wider, { includeViewport: true }));
        expect(captureCohortKey(hashed, { includePageUrl: false }))
            .toBe(captureCohortKey(otherPage, { includePageUrl: false }));
    });
    test('state captures may compare a shared cohort across distinct state URLs', () => {
        const otherPage = { ...legacy, page: { url: 'http://localhost/app?state=open' } };
        expect(captureCohortKey(legacy, { includePageUrl: false }))
            .toBe(captureCohortKey(otherPage, { includePageUrl: false }));
    });
});
