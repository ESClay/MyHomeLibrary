"use client";

import { PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RenameAuthorSheet } from "@/components/rename-author-sheet";
import type { AuthorVariantGroup } from "@/lib/books/author-variants";

/**
 * The authors under the title. Owners and editors get a "Fix spelling" button after each name, which opens a sheet that
 * changes the spelling for the whole library and lists the other spellings found.
 */
export function AuthorLine({
  authors,
  libraryId,
  canEdit,
  groups,
}: {
  authors: string[];
  libraryId: string;
  canEdit: boolean;
  groups: AuthorVariantGroup[];
}) {
  const router = useRouter();
  const [fixing, setFixing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (authors.length === 0) return <p className="text-base">Unknown author</p>;
  if (!canEdit) return <p className="text-base">{authors.join(", ")}</p>;

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 text-base">
        {authors.map((a, i) => (
          <li key={`${a}-${i}`} className="flex items-center gap-1">
            <span>
              {a}
              {i < authors.length - 1 ? "," : ""}
            </span>
            <button
              type="button"
              onClick={() => setFixing(a)}
              aria-label={`Fix spelling of ${a}`}
              className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95"
            >
              <PencilLine className="size-3.5" aria-hidden />
              Fix spelling
            </button>
          </li>
        ))}
      </ul>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {fixing && (
        <RenameAuthorSheet
          libraryId={libraryId}
          author={fixing}
          groups={groups}
          onClose={() => setFixing(null)}
          onDone={(message) => {
            setNotice(message);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
