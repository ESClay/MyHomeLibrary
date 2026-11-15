const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-03-01" -> "1 Mar 2026". Deterministic across server and browser. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatPrice(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : n.toFixed(2);
}

export function timesRead(n: number): string {
  return n === 1 ? "Read once" : `Read ${n} times`;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}
