"use client";

import { useTransition } from "react";
import { switchLibrary } from "@/app/(app)/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LibrarySummary } from "@/lib/library";

export function LibrarySwitcher({
  libraries,
  currentId,
}: {
  libraries: LibrarySummary[];
  currentId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={currentId}
      disabled={pending}
      onValueChange={(id) => startTransition(() => switchLibrary(id))}
    >
      <SelectTrigger aria-label="Switch library" className="h-9 w-full min-w-0 text-base md:text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {libraries.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
