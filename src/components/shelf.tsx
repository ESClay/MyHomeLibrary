import { cn } from "@/lib/utils";

type Spine = { w: number; h: number; tone: 1 | 2 | 3 | 4 | 5; lean?: boolean };

const tones = {
  1: "bg-spine-1",
  2: "bg-spine-2",
  3: "bg-spine-3",
  4: "bg-spine-4",
  5: "bg-spine-5",
} as const;

/** A row of book spines standing on a shelf line. Decorative; hidden from assistive tech. */
export function SpineRow({
  spines,
  gap,
  className,
}: {
  spines: Spine[];
  /** Index after which an empty slot (a missing volume) is drawn. */
  gap?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("flex flex-col", className)}>
      <div className="flex items-end gap-1 px-2">
        {spines.map((s, i) => (
          <div key={i} className="contents">
            <div
              className={cn(
                "relative rounded-t-[3px] rounded-b-[1px] shadow-[inset_2px_0_0_rgb(255_255_255/0.16),inset_-2px_0_0_rgb(0_0_0/0.14)] after:absolute after:inset-x-1 after:top-2 after:h-px after:bg-white/35 before:absolute before:inset-x-1 before:top-3.5 before:h-px before:bg-white/20",
                tones[s.tone],
                s.lean && "origin-bottom-left rotate-[7deg]",
              )}
              style={{ width: s.w, height: s.h }}
            />
            {gap === i && (
              <div
                className="rounded-t-[3px] border border-dashed border-gilt/70"
                style={{ width: 26, height: 84, borderBottom: 0 }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="shelf-line" />
    </div>
  );
}

/** Page header: eyebrow, serif title, optional lede, and a shelf line to stand the content on. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  className,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  className?: string;
}) {
  return (
    <header className={cn("rise flex flex-col gap-2", className)}>
      {eyebrow && <p className="eyebrow text-gilt">{eyebrow}</p>}
      <h1 className="page-title">{title}</h1>
      {lede && <p className="max-w-prose text-base text-muted-foreground">{lede}</p>}
    </header>
  );
}

/** Designed empty state: art on a shelf, a serif line, a plain explanation. */
export function EmptyState({
  title,
  body,
  art,
  children,
}: {
  title: string;
  body: string;
  art: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="rise panel flex flex-col gap-6 p-5 md:p-8" style={{ ["--i" as string]: 1 }}>
      <div className="mx-auto w-full max-w-sm">{art}</div>
      <div className="flex max-w-prose flex-col gap-2">
        <h2 className="text-2xl leading-tight font-medium">{title}</h2>
        <p className="text-base text-muted-foreground">{body}</p>
      </div>
      {children}
    </section>
  );
}
