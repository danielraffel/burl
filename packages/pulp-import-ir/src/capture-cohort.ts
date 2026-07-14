export interface CaptureEvidence {
    schema?: string;
    page?: { url?: string };
    policy?: Record<string, unknown>;
}

function stable(value: unknown): string {
    const sort = (item: any): any => Array.isArray(item) ? item.map(sort)
        : item && typeof item === 'object'
            ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]))
            : item;
    return JSON.stringify(sort(value));
}

export function captureCohortKey(evidence: CaptureEvidence,
                                 options: { includeViewport?: boolean; includePageUrl?: boolean } = {}): string {
    const policy = evidence.policy;
    if (!policy) throw new Error('capture evidence has no policy');
    const cohort = policy.cohortSha256;
    if (cohort !== undefined) {
        if (typeof cohort !== 'string' || !/^[0-9a-f]{64}$/.test(cohort))
            throw new Error('capture evidence has an invalid cohortSha256');
        const comparisonScope = {
            pageUrl: options.includePageUrl === false ? undefined : evidence.page?.url ?? null,
            viewport: options.includeViewport ? policy.viewport ?? null : undefined,
        };
        return `sha256:${cohort}:${stable(comparisonScope)}`;
    }
    if (policy.runtimeState !== undefined)
        throw new Error('capture evidence declares runtime state without a cohortSha256');
    const legacy = {
        schema: evidence.schema ?? null,
        pageUrl: options.includePageUrl === false ? undefined : evidence.page?.url ?? null,
        sourceRevision: policy.sourceRevision ?? null,
        clock: policy.clock ?? null,
        deviceScaleFactor: (policy.viewport as any)?.deviceScaleFactor ?? null,
        viewport: options.includeViewport ? policy.viewport ?? null : undefined,
        reload: policy.reload ?? null,
        clearStorage: policy.clearStorage ?? null,
        animations: policy.animations ?? null,
        transitions: policy.transitions ?? null,
        network: policy.network ?? null,
        hostServices: policy.hostServices ?? null,
    };
    return `legacy:${stable(legacy)}`;
}
