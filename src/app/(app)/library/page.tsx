import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, SpineRow } from "@/components/shelf";
import { loadLibraryItems } from "@/lib/books/data";
import { applyLibraryQuery, parseLibraryParams } from "@/lib/books/library-query";
import { getLibraryContext } from "@/lib/library";
import { loadShelf } from "@/lib/shelves/data";
import { canWriteShelf } from "@/lib/shelves/permissions";
import { createClient } from "@/lib/supabase/server";
import { LibraryBrowser, type ViewMode, VIEW_COOKIE } from "./library-browser";

export const metadata: Metadata = { title: "Library" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, current } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  const search = await searchParams;
  const params = parseLibraryParams(search);
  // "Edit rules" on a smart shelf comes here with ?editShelf=<id>; only a smart shelf this person may change counts.
  const editId = typeof search.editShelf === "string" && /^[0-9a-f-]{36}$/i.test(search.editShelf) ? search.editShelf : null;
  const editing = editId ? await loadShelf(editId) : null;
  const editShelf =
    editing && editing.kind === "smart" && editing.libraryId === current.id && canWriteShelf(current.role, user.id, editing)
      ? { id: editing.id, name: editing.name }
      : null;
  const supabase = await createClient();
  const [all, members, cookieStore] = await Promise.all([
    loadLibraryItems(current.id, user.id),
    supabase.from("library_members").select("user_id", { count: "exact", head: true }).eq("library_id", current.id),
    cookies(),
  ]);

  if (all.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <PageHeader eyebrow="Your books" title="Library" lede="Every book in your home, searchable by title, author or series." />
        <EmptyState
          title="The shelves are waiting"
          body="Add your first book and its cover lands here, with both of your ratings and notes beside it."
          art={
            <SpineRow
              gap={5}
              spines={[
                { w: 26, h: 118, tone: 1 },
                { w: 20, h: 96, tone: 3 },
                { w: 30, h: 132, tone: 2 },
                { w: 22, h: 104, tone: 5 },
                { w: 28, h: 124, tone: 4 },
                { w: 20, h: 92, tone: 1 },
              ]}
            />
          }
        >
          {current.role !== "viewer" && (
            <div>
              <Button asChild>
                <Link href="/add">Add a book</Link>
              </Button>
            </div>
          )}
        </EmptyState>
      </div>
    );
  }

  const matches = applyLibraryQuery(all, params);
  const shown = matches.slice(0, params.limit);
  const seriesNames = [...new Set(all.map((i) => i.seriesName).filter((s): s is string => !!s))].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );
  const view: ViewMode = cookieStore.get(VIEW_COOKIE)?.value === "list" ? "list" : "grid";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader eyebrow={current.name} title="Library" />
      <LibraryBrowser
        items={shown}
        total={matches.length}
        librarySize={all.length}
        params={params}
        seriesNames={seriesNames}
        hasPartners={(members.count ?? 1) > 1}
        initialView={view}
        libraryId={current.id}
        role={current.role}
        editShelf={editShelf}
      />
    </div>
  );
}
