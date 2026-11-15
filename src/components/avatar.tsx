import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Member avatar: their photo when they have one, otherwise initials on a brass disc. */
export function Avatar({ name, url, className }: { name: string; url: string | null; className?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" referrerPolicy="no-referrer" className={cn("size-9 shrink-0 rounded-full object-cover", className)} />
  ) : (
    <span
      aria-hidden
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground", className)}
    >
      {initials(name)}
    </span>
  );
}
