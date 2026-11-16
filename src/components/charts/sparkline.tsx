/**
 * A tiny trend line: 2px stroke, an end dot (r = 4) with a 2px surface ring. One series, so no legend; the label names what is plotted
 * and the caller supplies the values in a table beside it. Oldest point first.
 */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 36;
  const PAD = 6; // keeps the end dot and its ring inside the box
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
    const y = max === min ? H / 2 : PAD + (1 - (v - min) / span) * (H - PAD * 2);
    return [x, y] as const;
  });
  const last = pts[pts.length - 1];
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className={className ?? "h-9 w-[7.5rem]"} fill="none">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} stroke="var(--cloth)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--cloth)" stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}
