/** Returns `next` only if it is a same-origin relative path; otherwise the fallback. */
export function safeNext(next: string | null | undefined, fallback = "/library") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
