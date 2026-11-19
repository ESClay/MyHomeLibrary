import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLibraryContext } from "@/lib/library";
import { loadShelf, loadShelfDetail } from "@/lib/shelves/data";
import { canChangeShelfBooks, canWriteShelf } from "@/lib/shelves/permissions";
import { rulesQueryString } from "@/lib/shelves/rules";
import { ShelfDetail } from "./shelf-detail";

type Props = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Shelf" };

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { user, libraries } = await getLibraryContext();
  const shelf = await loadShelf(id); // RLS: another member's private shelf is simply not found.
  if (!shelf) notFound();
  const lib = libraries.find((l) => l.id === shelf.libraryId);
  if (!lib) notFound();

  const detail = await loadShelfDetail(shelf, user.id);
  const manage = canWriteShelf(lib.role, user.id, shelf);
  const rulesHref = shelf.kind === "smart" ? `/library?${rulesQueryString(shelf.rules ?? {})}${shelf.rules && Object.keys(shelf.rules).length ? "&" : ""}editShelf=${shelf.id}` : null;

  return (
    <ShelfDetail
      key={detail.books.map((b) => b.id).join(",") + shelf.sort + shelf.name}
      shelf={shelf}
      books={detail.books}
      total={detail.total}
      hasMore={detail.hasMore}
      libraryName={lib.name}
      role={lib.role}
      canManage={manage}
      canChangeBooks={canChangeShelfBooks(lib.role, user.id, shelf)}
      rulesHref={rulesHref}
    />
  );
}
