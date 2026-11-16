import type { ProviderName } from "./types";

/**
 * Which online providers a lookup may use. Hardcover and Google Books are quota-limited and keyed, so they are only for
 * people with full access (src/lib/access.ts); everyone else gets Open Library, which is free and keyless.
 * Every lookup in lib/metadata takes one, so a caller cannot reach a keyed provider without deciding.
 */
export type ProviderPolicy = { providers: readonly ProviderName[] };

export const ALL_PROVIDERS: ProviderPolicy = { providers: ["hardcover", "google", "openlibrary"] };
export const OPEN_PROVIDERS: ProviderPolicy = { providers: ["openlibrary"] };

/** The policy for a person: everything with full access, Open Library only without. */
export function providersFor(fullAccess: boolean): ProviderPolicy {
  return fullAccess ? ALL_PROVIDERS : OPEN_PROVIDERS;
}

/** A stable key for a provider set (order does not matter), used to keep cached results apart. */
export function providerSetKey(policy: ProviderPolicy): string {
  return [...new Set(policy.providers)].sort().join("+") || "none";
}
