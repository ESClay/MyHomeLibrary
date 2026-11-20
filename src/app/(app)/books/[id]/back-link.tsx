"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cameFromLibrary, loadLibraryUrl, tabStorage } from "@/lib/books/library-memory";

/**
 * "Library" on a book. Straight from the library it steps back in history, so the list is where it was.
 * Otherwise it is a normal link to the last library URL (sort, filters, search) or plain /library.
 * The href is real, so middle-click, open in new tab and no-JS all work.
 */
export function BackLink() {
  const router = useRouter();
  const pathname = usePathname();
  const [href, setHref] = useState("/library");
  const [fromLibrary, setFromLibrary] = useState(false);
  useEffect(() => {
    const store = tabStorage();
    /* eslint-disable react-hooks/set-state-in-effect -- reads tab storage, which the server render can't see */
    setHref(loadLibraryUrl(store) ?? "/library");
    setFromLibrary(cameFromLibrary(store, pathname));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname]);

  return (
    <Link
      href={href}
      scroll={false}
      onClick={(e) => {
        if (!fromLibrary || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        router.back();
      }}
      className="-ml-2 flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ArrowLeft className="size-4" aria-hidden /> Library
    </Link>
  );
}
