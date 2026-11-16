import { describe, expect, it } from "vitest";
import { createBookSchema } from "@/lib/books/schemas";
import type { GapEntry } from "./gaps";
import { createInputFromMetadata, entryToMetadata } from "./to-book";

const entry: GapEntry = {
  id: "e1",
  position: 2.5,
  title: "Dune Messiah",
  authors: ["Frank Herbert"],
  hardcoverBookId: 427393,
  isbn13: "9781690319856",
  coverUrl: "https://assets.hardcover.app/x.jpg",
  releaseDate: "1969-01-01",
  isCompilation: false,
};

describe("series entry to book", () => {
  it("builds a record the add-book action accepts, as a wishlist book", () => {
    const m = entryToMetadata(entry, "Dune");
    expect(m).toMatchObject({ title: "Dune Messiah", seriesName: "Dune", seriesPosition: 2.5, isbn13: "9781690319856", ids: { hardcover: 427393 } });
    const input = createInputFromMetadata("11111111-1111-4111-8111-111111111111", m, { ownership: "wishlist" });
    const parsed = createBookSchema.parse(input);
    expect(parsed.book).toMatchObject({ ownership: "wishlist", seriesName: "Dune", seriesPosition: 2.5, coverUrl: "https://assets.hardcover.app/x.jpg" });
    expect(parsed.provider.hardcoverId).toBe(427393);
    expect(parsed.copy).toBeNull();
    expect(parsed.myStatus).toBe("want");
  });

  it("gives an owned book one paperback copy and the chosen status", () => {
    const input = createInputFromMetadata("11111111-1111-4111-8111-111111111111", entryToMetadata(entry, "Dune"), { ownership: "owned", myStatus: "read" });
    const parsed = createBookSchema.parse(input);
    expect(parsed.copy).toMatchObject({ format: "paperback" });
    expect(parsed.myStatus).toBe("read");
  });
});
