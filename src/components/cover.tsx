import { cn } from "@/lib/utils";

const TONES = ["bg-spine-1", "bg-spine-2", "bg-spine-3", "bg-spine-4", "bg-spine-5"] as const;

function toneFor(title: string) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** A book cover on the shelf: the real image when there is one, otherwise a cloth-bound stand-in with the title. */
export function Cover({
  url,
  title,
  author,
  className,
  priority = false,
}: {
  url: string | null;
  title: string;
  author?: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("book-cover @container w-full", className)}>
      {url ? (
        // Covers come from several providers and our storage bucket; they are remote and already sized.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Cover of ${title}`}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      ) : (
        <div
          role="img"
          aria-label={`No cover for ${title}`}
          className={cn("flex size-full flex-col justify-between p-[10%] text-white", toneFor(title))}
        >
          <span className="font-display line-clamp-5 text-[clamp(0.55rem,11cqw,1.15rem)] leading-tight font-medium">
            {title}
          </span>
          {author && <span className="line-clamp-2 text-[clamp(0.45rem,7cqw,0.7rem)] tracking-wide uppercase opacity-80">{author}</span>}
        </div>
      )}
    </div>
  );
}
