import Link from "next/link";
import { Cover } from "@/components/cover";
import { CoverLoanTag } from "@/components/loan-badge";
import type { CoverLite } from "@/lib/shelves/types";
import { cn } from "@/lib/utils";

/** A horizontal run of covers standing on a shelf line. Scroll-snaps, so a swipe lands on a cover. */
export function CoverStrip({ covers, empty, className }: { covers: CoverLite[]; empty?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      {covers.length === 0 ? (
        <p className="flex h-24 items-end px-1 pb-3 text-sm text-muted-foreground">{empty ?? "Nothing here yet."}</p>
      ) : (
        <ul className="-mx-4 flex snap-x snap-mandatory items-end gap-3 overflow-x-auto scroll-px-4 px-4 pt-1 pb-3 [scrollbar-width:none] sm:mx-0 sm:px-0 sm:scroll-px-0 [&::-webkit-scrollbar]:hidden">
          {covers.map((c, i) => (
            <li key={c.id} className="w-[5.5rem] shrink-0 snap-start sm:w-28">
              <Link
                href={`/books/${c.id}`}
                className="relative block rounded-[3px] outline-offset-4"
                aria-label={c.loan ? `${c.title}, ${c.loan.overdue ? "overdue" : c.loan.direction === "out" ? "on loan" : "borrowed"}` : c.title}
              >
                <Cover url={c.coverUrl} title={c.title} author={c.author ?? undefined} priority={i < 3} />
                {c.loan && <CoverLoanTag loan={c.loan} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="shelf-line" />
    </div>
  );
}
