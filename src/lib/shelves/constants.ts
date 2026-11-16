import type { Sort } from "@/lib/books/library-query";

export const SHELF_COLORS = ["spine-1", "spine-2", "spine-3", "spine-4", "spine-5"] as const;
export type ShelfColor = (typeof SHELF_COLORS)[number];
export const SHELF_COLOR_LABEL: Record<ShelfColor, string> = {
  "spine-1": "Oxblood",
  "spine-2": "Forest",
  "spine-3": "Brass",
  "spine-4": "Slate",
  "spine-5": "Terracotta",
};
/** Full class names so Tailwind can see them. */
export const SHELF_COLOR_BG: Record<ShelfColor, string> = {
  "spine-1": "bg-spine-1",
  "spine-2": "bg-spine-2",
  "spine-3": "bg-spine-3",
  "spine-4": "bg-spine-4",
  "spine-5": "bg-spine-5",
};

/** A curated set that fits a reading room. Stored by key; the component maps key to icon. */
export const SHELF_ICON_KEYS = [
  "book-open",
  "bookmark",
  "armchair",
  "lamp",
  "coffee",
  "moon",
  "feather",
  "star",
  "heart",
  "gift",
  "graduation-cap",
  "sprout",
] as const;
export type ShelfIconKey = (typeof SHELF_ICON_KEYS)[number];
export const SHELF_ICON_LABEL: Record<ShelfIconKey, string> = {
  "book-open": "Open book",
  bookmark: "Bookmark",
  armchair: "Armchair",
  lamp: "Reading lamp",
  coffee: "Coffee",
  moon: "Moon",
  feather: "Feather",
  star: "Star",
  heart: "Heart",
  gift: "Gift",
  "graduation-cap": "Study",
  sprout: "Sprout",
};

export const SHELF_VISIBILITIES = ["shared", "private"] as const;
export type ShelfVisibility = (typeof SHELF_VISIBILITIES)[number];
export const SHELF_KINDS = ["manual", "smart"] as const;
export type ShelfKind = (typeof SHELF_KINDS)[number];

export const SHELF_SORTS = ["series", "author", "title", "added", "my_rating", "public_rating", "custom"] as const;
export type ShelfSort = (typeof SHELF_SORTS)[number];
export const SHELF_SORT_LABEL: Record<ShelfSort, string> = {
  series: "Series order",
  author: "Author",
  title: "Title",
  added: "Date added",
  my_rating: "My rating",
  public_rating: "Public rating",
  custom: "My own order",
};
/** How a shelf sort maps onto the library list's sort. Custom has no library equivalent. */
export const SHELF_SORT_TO_LIBRARY: Record<Exclude<ShelfSort, "custom">, Sort> = {
  series: "series",
  author: "author",
  title: "title",
  added: "added",
  my_rating: "myrating",
  public_rating: "rating",
};

/** How many covers a row on the shelves page shows. */
export const ROW_COVERS = 12;
