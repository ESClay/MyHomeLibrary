import { coverHostRules, type CoverHostRule } from "./cover-hosts";

/** Matches a `**`-style pathname pattern (a trailing `/**` or a lone `/**`). */
function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern === "/**") return true;
  if (pattern.endsWith("/**")) return pathname.startsWith(pattern.slice(0, -2));
  return pathname === pattern;
}

/**
 * True when next/image may optimize this cover URL: https, on a host (and path) allowed in images.remotePatterns.
 * Anything else (an unknown host, http, a bad URL) must be rendered unoptimized, or next/image would refuse it.
 */
export function isOptimizableCover(url: string, rules: CoverHostRule[] = coverHostRules(process.env.NEXT_PUBLIC_SUPABASE_URL)): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "") return false;
  return rules.some((r) => r.hostname === u.hostname && pathMatches(r.pathname, u.pathname) && (r.search === undefined || u.search === r.search));
}
