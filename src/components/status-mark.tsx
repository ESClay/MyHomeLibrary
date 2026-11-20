import { Bookmark, BookOpen, Check, X, type LucideIcon } from "lucide-react";
import type { Status } from "@/lib/books/constants";
import { statusMarkerInfo } from "@/lib/books/status-marker";
import { cn } from "@/lib/utils";

/** Icon and fill per status. The glyph differs too, so colour is never the only signal. */
const LOOK: Record<Status, { Icon: LucideIcon; tone: string }> = {
  want: { Icon: Bookmark, tone: "bg-card text-foreground" },
  reading: { Icon: BookOpen, tone: "bg-gilt text-background" },
  read: { Icon: Check, tone: "bg-primary text-primary-foreground" },
  dnf: { Icon: X, tone: "bg-foreground text-background" },
};

/** The status glyph on its own solid disc, with a dark hairline and shadow so it reads on any cover. */
export function StatusDot({ status, className }: { status: Status; className?: string }) {
  const { Icon, tone } = LOOK[status];
  return (
    <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ring-black/30", tone, className)}>
      <Icon className="size-3" strokeWidth={2.75} />
    </span>
  );
}

/** Cover form: icon only, bottom-right of the cover, named for screen readers. Nothing when there is no status. */
export function CoverStatusMark({ status }: { status: Status | null | undefined }) {
  const info = statusMarkerInfo(status);
  if (!info) return null;
  return (
    <span role="img" aria-label={info.name} title={info.label} className="absolute right-1.5 bottom-1.5">
      <StatusDot status={info.status} />
    </span>
  );
}

/** List form: the same disc with its label beside it. */
export function InlineStatusMark({ status }: { status: Status | null | undefined }) {
  const info = statusMarkerInfo(status);
  if (!info) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <StatusDot status={info.status} />
      {info.label}
    </span>
  );
}

/** Bare glyph for the status chips. */
export function StatusGlyph({ status, className }: { status: Status; className?: string }) {
  const { Icon } = LOOK[status];
  return <Icon aria-hidden className={cn("size-4", className)} />;
}
