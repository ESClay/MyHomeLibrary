import { cn } from "@/lib/utils";

/** Three spines on a shelf: the app's mark. Same drawing as the PWA icon. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7 shrink-0", className)}>
      <rect x="4" y="9" width="6" height="16" rx="1" className="fill-spine-1" />
      <rect x="11.5" y="5" width="6" height="20" rx="1" className="fill-cloth" />
      <rect x="19" y="8" width="6" height="17" rx="1" className="fill-spine-3" transform="rotate(0)" />
      <rect x="2" y="25.5" width="28" height="2.5" rx="1" className="fill-[var(--shelf)]" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-xl leading-none font-medium tracking-tight", className)}>
      My<em className="px-px font-normal text-gilt italic">Home</em>Library
    </span>
  );
}
