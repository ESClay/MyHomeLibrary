import type { ShelfColor, ShelfKind, ShelfSort, ShelfVisibility } from "./constants";
import type { ShelfRules } from "./rules";

export type Shelf = {
  id: string;
  libraryId: string;
  name: string;
  color: ShelfColor;
  icon: string | null;
  visibility: ShelfVisibility;
  kind: ShelfKind;
  rules: ShelfRules | null;
  sort: ShelfSort;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
};

export type ShelfBookRef = { shelfId: string; bookId: string; position: number };

export type CoverLite = { id: string; title: string; author: string | null; coverUrl: string | null };

export type ShelfRowData = {
  shelf: Shelf;
  count: number;
  covers: CoverLite[];
};

export type ReadingGroup = { userId: string; name: string; isMe: boolean; count: number; covers: CoverLite[] };
