import "server-only";

type Entry = { expires: number; value: unknown };

const cache = new Map<string, Entry>();
const MAX_ENTRIES = 300;

export const DEFAULT_TIMEOUT_MS = 6000;
export const DEFAULT_TTL_MS = 5 * 60 * 1000;

export type FetchJsonOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  ttlMs?: number;
  /** Extra cache-key material (never put secrets here). */
  cacheKey?: string;
};

/**
 * JSON fetch with a hard timeout and a short in-memory cache (per server instance).
 * Throws on network errors, timeouts, non-2xx responses and invalid JSON; callers
 * decide how to degrade. Failures are never cached.
 */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const key = `${opts.method ?? "GET"} ${url} ${opts.cacheKey ?? opts.body ?? ""}`;
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { accept: "application/json", "user-agent": "MyHomeLibrary/0.1", ...opts.headers },
    body: opts.body,
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const value = (await res.json()) as T;

  if (ttl > 0) {
    if (cache.size >= MAX_ENTRIES) {
      for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    }
    cache.set(key, { expires: now + ttl, value });
  }
  return value;
}

/** Clears the response cache. Used by tests. */
export function clearFetchCache() {
  cache.clear();
}
