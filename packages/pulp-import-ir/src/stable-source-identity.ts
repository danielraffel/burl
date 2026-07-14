export function stableAuthoredSourceSuffix(sourceId: string): string {
    const segments = sourceId.split('/');
    const authoredRoot = segments.findIndex((segment) =>
        /-(?:id|data-slot|data-testid)-/.test(segment));
    return authoredRoot >= 0 ? segments.slice(authoredRoot).join('/') : sourceId;
}

export function resolveUniqueStableSourceId(
    requested: string,
    available: Iterable<string>,
): string {
    const identities = [...new Set(available)];
    if (identities.includes(requested)) return requested;
    const suffix = stableAuthoredSourceSuffix(requested);
    const matches = identities.filter((candidate) =>
        stableAuthoredSourceSuffix(candidate) === suffix);
    if (matches.length !== 1) {
        throw new Error(
            `stable source identity ${requested} resolved ${matches.length} candidates for suffix ${suffix}`,
        );
    }
    return matches[0];
}
