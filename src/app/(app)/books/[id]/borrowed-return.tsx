"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { returnBorrowedBook } from "@/app/(app)/loans/actions";
import { Button } from "@/components/ui/button";

/** "Returned it": the book went back to its owner, so either take it off the shelves or keep it as a wishlist entry. */
export function BorrowedReturn({ bookId, title }: { bookId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish(then: "remove" | "wishlist") {
    setError(null);
    startTransition(async () => {
      const res = await returnBorrowedBook({ bookId, then });
      if (!res.ok) return setError(res.error);
      if (res.removed) router.replace("/library");
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden /> Returned it
      </Button>
    );
  }
  return (
    <div role="group" aria-label="Returned it" className="panel flex flex-col gap-3 border-gilt p-4">
      <p className="text-[0.9375rem]">
        You gave <strong className="font-semibold">{title}</strong> back. What should happen to it in your library?
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="destructive" disabled={pending} onClick={() => finish("remove")}>
          Remove it from the library
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => finish("wishlist")}>
          Keep it on my wishlist
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Not yet
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
