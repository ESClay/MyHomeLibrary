import Image from "next/image";
import { isOptimizableCover } from "@/lib/cover-image";
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
  sizes = "64px",
}: {
  url: string | null;
  title: string;
  author?: string;
  className?: string;
  priority?: boolean;
  /** How wide the cover is drawn, for the browser to pick a variant. Default suits the small list thumbnails. */
  sizes?: string;
}) {
  return (
    <div className={cn("book-cover @container w-full", className)}>
      {url ? (
        // fill + sizes: the box above sets the aspect ratio. Unknown hosts are not in images.remotePatterns, so they skip the optimizer.
        <Image
          src={url}
          alt={`Cover of ${title}`}
          fill
          sizes={sizes}
          preload={priority}
          loading={priority ? "eager" : "lazy"}
          unoptimized={!isOptimizableCover(url)}
          referrerPolicy="no-referrer"
          className="object-cover"
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
