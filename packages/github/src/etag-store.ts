/**
 * Persists GitHub ETags so the installation client can issue conditional requests
 * (`If-None-Match`). An authorized `304 Not Modified` does not count against the
 * primary rate limit, so this makes repeated revalidation near-free.
 *
 * ETags are scoped per page URL and per installation token, hence the
 * (installationId, requestKey) pair. Implementations live outside this package
 * (e.g. a Postgres-backed store in the API) so `@autonoma/github` stays free of a
 * database dependency.
 */
export interface EtagStore {
    get(installationId: number, requestKey: string): Promise<string | undefined>;
    set(installationId: number, requestKey: string, etag: string): Promise<void>;
}
