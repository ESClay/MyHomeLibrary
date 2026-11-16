import type { Metadata } from "next";
import { getLibraryContext } from "@/lib/library";
import { loadShelvesOverview } from "@/lib/shelves/data";
import { ShelvesBoard } from "./shelves-board";

export const metadata: Metadata = { title: "Shelves" };

export default async function Page() {
  const { user, current } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  const { rows, reading } = await loadShelvesOverview(current.id, user.id);
  return <ShelvesBoard libraryId={current.id} libraryName={current.name} userId={user.id} role={current.role} rows={rows} reading={reading} />;
}
