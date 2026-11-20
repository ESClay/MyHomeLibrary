import { describe, expect, it } from "vitest";
import { planBookFill, type FillBook } from "./fill";

const empty: FillBook = {
  subtitle: null, authors: [], series_name: null, series_position: null, description: null, cover_url: null, page_count: null,
  published_date: null, genres: [], isbn13: null, hardcover_id: null, google_books_id: null, ol_key: null,
  public_rating: null, public_rating_count: null, rating_source: null,
};

describe("planBookFill", () => {
  it("fills empty fields and never overwrites existing ones", () => {
    const existing = { ...empty, description: "mine", page_count: 300 };
    const patch = planBookFill(existing, { description: "theirs", page_count: 999, subtitle: " Sub ", isbn13: "9780000000002", genres: ["Fantasy"] }, false);
    expect(patch).toEqual({ subtitle: "Sub", isbn13: "9780000000002", genres: ["Fantasy"] });
  });
  it("keeps the series name and number together, and the rating trio together", () => {
    expect(planBookFill({ ...empty, series_name: "Mine" }, { series_name: "Theirs", series_position: 3 }, false)).toEqual({});
    expect(planBookFill(empty, { series_name: "Theirs", series_position: 3 }, false)).toEqual({ series_name: "Theirs", series_position: 3 });
    expect(planBookFill(empty, { public_rating: 4.2, public_rating_count: 10, rating_source: "hardcover" }, false)).toEqual({
      public_rating: 4.2, public_rating_count: 10, rating_source: "hardcover",
    });
  });
  it("replaces the cover only when asked, and fills a missing one regardless", () => {
    const has = { ...empty, cover_url: "https://a/old.jpg" };
    expect(planBookFill(has, { cover_url: "https://a/new.jpg" }, false)).toEqual({});
    expect(planBookFill(has, { cover_url: "https://a/new.jpg" }, true)).toEqual({ cover_url: "https://a/new.jpg" });
    expect(planBookFill(empty, { cover_url: "https://a/new.jpg" }, false)).toEqual({ cover_url: "https://a/new.jpg" });
    expect(planBookFill(has, {}, true)).toEqual({});
  });
});
