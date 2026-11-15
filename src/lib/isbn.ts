/** ISBN helpers. Pure, safe to import from client and server code. */

/** Strip hyphens/spaces and uppercase a trailing X. Returns "" for anything that is not 10 or 13 chars. */
export function cleanIsbn(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(s) || /^\d{9}[\dX]$/.test(s)) return s;
  return "";
}

export function isIsbn13(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

export function isIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

/** Convert a valid ISBN-10 to ISBN-13 (978 prefix). Returns null when the input is not a valid ISBN-10. */
export function isbn10To13(raw: string): string | null {
  const s = cleanIsbn(raw);
  if (!isIsbn10(s)) return null;
  const body = `978${s.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** Any ISBN-10 or ISBN-13 string to a valid ISBN-13, or null. */
export function toIsbn13(raw: string | null | undefined): string | null {
  const s = cleanIsbn(raw);
  if (!s) return null;
  if (s.length === 13) return isIsbn13(s) ? s : null;
  return isbn10To13(s);
}

/** True for a string that looks like someone typing an ISBN into a search box. */
export function looksLikeIsbn(query: string): boolean {
  const s = cleanIsbn(query);
  return s !== "" && toIsbn13(s) !== null;
}
