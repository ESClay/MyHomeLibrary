import { cn } from "@/lib/utils";

/*
 * Route loading skeletons. They are shown the instant a nav link is clicked, so they borrow the real layouts'
 * widths, the page header's rhythm, the cover frame and the panel, and stay still apart from a slow pulse
 * (which rests under reduced motion). No entrance animation: the real page owns that.
 */

const bar = "block animate-pulse rounded-full bg-muted motion-reduce:animate-none";

/** Wraps a skeleton: one polite "Loading" for assistive tech, and the width of the page it stands in for. */
export function SkeletonPage({ width = "max-w-3xl", gap = "gap-8", label = "Loading", children }: { width?: string; gap?: string; label?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("mx-auto flex w-full flex-col", width, gap)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden className={cn("flex flex-col", gap)}>
        {children}
      </div>
    </div>
  );
}

/** Eyebrow, serif title and an optional lede, where PageHeader puts them. */
export function HeaderSkeleton({ lede = false }: { lede?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <span className={cn(bar, "h-2.5 w-24")} />
      <span className={cn(bar, "h-9 w-48 rounded-lg")} />
      {lede && <span className={cn(bar, "h-3 w-full max-w-prose")} />}
    </div>
  );
}

/** A grid of cover frames with a title and a byline under each, the way the library lays books out. */
export function CoverGridSkeleton({ count = 14 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex flex-col gap-2">
          <div className="book-cover animate-pulse motion-reduce:animate-none" />
          <span className={cn(bar, "h-2.5 w-4/5")} />
          <span className={cn(bar, "h-2 w-3/5")} />
        </li>
      ))}
    </ul>
  );
}

/** A search field and a row of controls above the list. */
export function ToolbarSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <span className="h-11 flex-1 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <span className="h-11 w-12 animate-pulse rounded-lg bg-muted motion-reduce:animate-none sm:w-28" />
      </div>
      <div className="flex items-center gap-3">
        <span className={cn(bar, "mr-auto h-2.5 w-24")} />
        <span className="h-10 w-36 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <span className="h-10 w-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}

/** A panel with a heading, a line of text and some body rows. */
export function PanelSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("panel flex flex-col gap-5 p-5 md:p-8", className)}>
      <div className="flex flex-col gap-2.5">
        <span className={cn(bar, "h-5 w-2/5")} />
        <span className={cn(bar, "h-3 w-4/5 max-w-prose")} />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className={cn(bar, "h-3", i % 2 ? "w-3/5" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

/** Two-up cards with a cover on the left and text lines on the right, as the Discover picks use. */
export function PickCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-4 rounded-[10px] border border-dashed border-input p-4">
          <div className="book-cover w-20 shrink-0 animate-pulse border-0 shadow-none motion-reduce:animate-none" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <span className={cn(bar, "h-3 w-3/5")} />
            <span className={cn(bar, "h-2.5 w-2/5")} />
            <span className={cn(bar, "mt-2 h-2.5 w-full")} />
            <span className={cn(bar, "h-2.5 w-4/5")} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A row of stacked link cards (the Add page's entries, a list of borrowers). */
export function RowCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel flex min-h-[4.5rem] items-center gap-4 p-4">
          <span className="size-11 shrink-0 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          <div className="flex flex-1 flex-col gap-2">
            <span className={cn(bar, "h-3 w-2/5")} />
            <span className={cn(bar, "h-2.5 w-4/5")} />
          </div>
        </div>
      ))}
    </div>
  );
}
