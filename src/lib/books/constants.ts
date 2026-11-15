export const FORMATS = ["hardcover", "paperback", "ebook", "audiobook"] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABEL: Record<Format, string> = {
  hardcover: "Hardcover",
  paperback: "Paperback",
  ebook: "E-book",
  audiobook: "Audiobook",
};

export const CONDITIONS = ["new", "like_new", "very_good", "good", "acceptable"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABEL: Record<Condition, string> = {
  new: "New",
  like_new: "Like new",
  very_good: "Very good",
  good: "Good",
  acceptable: "Acceptable",
};

export const STATUSES = ["want", "reading", "read", "dnf"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  want: "Want to read",
  reading: "Reading",
  read: "Read",
  dnf: "Did not finish",
};

export const OWNERSHIPS = ["owned", "wishlist"] as const;
export type Ownership = (typeof OWNERSHIPS)[number];
export const OWNERSHIP_LABEL: Record<Ownership, string> = { owned: "Owned", wishlist: "Wishlist" };

export const RATING_SOURCE_LABEL: Record<string, string> = {
  hardcover: "Hardcover",
  google: "Google Books",
  openlibrary: "Open Library",
};
