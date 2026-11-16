import type { BookMetadata } from "@/lib/metadata/types";

/** One recommendation as stored in `recommendation_sets.items`. */
export type StoredPick = {
  /** workKey(title, authors): what feedback is filed under. */
  key: string;
  title: string;
  authors: string[];
  /** One or two sentences (shared picks: the per-person lines joined). */
  reason: string;
  /** Shared picks: why it fits each person, by display name. */
  fit: { person: string; why: string }[];
  series: { name: string; position: number | null } | null;
  /** The catalogue record the pick resolved to; used for the cover and to add it to the wishlist. */
  book: BookMetadata;
};

export type DropCounts = { notFound: number; inLibrary: number; blocked: number; duplicate: number };
