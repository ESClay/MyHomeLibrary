import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cleanDescription,
  parseCalibreCsv,
  parseCalibreDate,
  parseIdentifiers,
  parseSeriesIndex,
  splitAuthors,
} from "./parse";

const fixture = readFileSync(fileURLToPath(new URL("./__fixtures__/calibre-catalog.csv", import.meta.url)), "utf8");
const noYield = async () => {};

async function parse(text: string) {
  return parseCalibreCsv(text, { yieldFn: noYield });
}

describe("fixture file (BOM, CRLF, quoted values, custom columns)", () => {
  it("starts with a BOM and uses CRLF, as the test needs", () => {
    expect(fixture.charCodeAt(0)).toBe(0xfeff);
    expect(fixture).toContain("\r\n");
  });

  it("reads every row and recognizes the standard and custom columns", async () => {
    const cat = await parse(fixture);
    expect(cat.fatal).toBeNull();
    expect(cat.rows).toHaveLength(9);
    expect(cat.headers[0]).toBe("title"); // the BOM is gone
    expect(cat.recognized).toEqual(expect.arrayContaining(["title", "authors", "series", "series_index", "isbn", "identifiers", "comments", "pubdate", "publisher", "formats", "uuid", "languages"]));
    expect(cat.customColumns.map((c) => c.header)).toEqual(["#read", "#finished", "#status", "#pages"]);
    expect(cat.customColumns.find((c) => c.header === "#read")?.filled).toBe(7);
  });

  it("does not import rating or tags", async () => {
    const cat = await parse(fixture);
    expect(Object.keys(cat.rows[0])).not.toContain("rating");
    expect(Object.keys(cat.rows[0])).not.toContain("tags");
    expect(cat.recognized).not.toContain("rating");
    expect(cat.recognized).not.toContain("tags");
  });

  it("maps a plain row", async () => {
    const [fellowship] = (await parse(fixture)).rows;
    expect(fellowship).toMatchObject({
      n: 1,
      title: "The Fellowship of the Ring",
      authors: ["J. R. R. Tolkien"],
      series: "The Lord of the Rings",
      seriesPosition: 1,
      isbn13: "9780261102354",
      identifiers: { goodreads: "34" },
      publishedDate: "1954-07-29",
      publisher: "HarperCollins",
      languages: ["eng"],
      formats: ["epub", "mobi"],
      calibreUuid: "0a1b2c3d-0000-4000-8000-000000000001",
      error: null,
    });
    expect(fellowship.description).toBe("The first part of the epic. Frodo inherits a ring, and a quest.");
    expect(fellowship.custom).toMatchObject({ "#read": "True", "#status": "Read", "#pages": "423" });
  });

  it("splits several authors and drops Calibre's series_index 1.0 when there is no series", async () => {
    const goodOmens = (await parse(fixture)).rows[1];
    expect(goodOmens.authors).toEqual(["Neil Gaiman", "Terry Pratchett"]);
    expect(goodOmens.series).toBeNull();
    expect(goodOmens.seriesPosition).toBeNull();
  });

  it("keeps quotes, commas and line breaks inside a quoted HTML comment, sanitized", async () => {
    const goodOmens = (await parse(fixture)).rows[1];
    expect(goodOmens.description).toContain('The "nice and accurate" prophecies of Agnes Nutter, witch, are, as it turns out, accurate.');
    expect(goodOmens.description).toContain("Armageddon, however, is late.");
    expect(goodOmens.description).not.toMatch(/<|>/);
    expect(goodOmens.description?.endsWith("End")).toBe(true);
  });

  it("keeps odd series_index values: 2.5 stays, 0 and 1.0 behave", async () => {
    const rows = (await parse(fixture)).rows;
    expect(rows[2].seriesPosition).toBe(2.5);
    expect(rows[3].series).toBe("Dune Chronicles");
    expect(rows[3].seriesPosition).toBeNull(); // 0.0 means no position
    expect(rows[0].seriesPosition).toBe(1); // 1.0
  });

  it("finds an ISBN that only exists in identifiers, and keeps the other identifiers", async () => {
    const dune = (await parse(fixture)).rows[3];
    expect(dune.isbn13).toBe("9780441172719");
    expect(dune.identifiers).toEqual({ goodreads: "234225", "mobi-asin": "B000SEI" });
  });

  it("converts a hyphenated ISBN-10 and treats Calibre's undefined pubdate as none", async () => {
    const rows = (await parse(fixture)).rows;
    expect(rows[4].isbn13).toBe("9780345339683");
    expect(rows[4].languages).toEqual(["eng", "fra"]);
    expect(rows[3].publishedDate).toBeNull();
  });

  it("flags a row with no title without stopping the file", async () => {
    const rows = (await parse(fixture)).rows;
    expect(rows[5].error).toMatch(/no title/i);
    expect(rows.filter((r) => r.error === null)).toHaveLength(7);
  });

  it("flags a repeated uuid on the later row only", async () => {
    const rows = (await parse(fixture)).rows;
    expect(rows[0].error).toBeNull();
    expect(rows[6].error).toBe("Repeats the Calibre id of row 1.");
  });

  it("keeps a literal ampersand, notes an invalid ISBN and treats Unknown as no author", async () => {
    const rows = (await parse(fixture)).rows;
    expect(rows[7].title).toBe("Les Misérables");
    expect(rows[7].authors).toEqual(["Victor Hugo", "Johnson & Johnson"]);
    expect(rows[7].isbn13).toBeNull();
    expect(rows[7].notes[0]).toMatch(/not valid/);
    expect(rows[7].publishedDate).toBe("1862");
    expect(rows[8].authors).toEqual([]);
  });
});

describe("tolerance", () => {
  it("accepts any subset of columns as long as title is there", async () => {
    const cat = await parse("title\nOnly A Title\n");
    expect(cat.fatal).toBeNull();
    expect(cat.rows).toHaveLength(1);
    expect(cat.rows[0]).toMatchObject({ title: "Only A Title", authors: [], isbn13: null, series: null, calibreUuid: null, error: null });
  });

  it("is fatal without a title column, and for empty files", async () => {
    expect((await parse("authors,isbn\nSomeone,123\n")).fatal).toMatch(/no title column/);
    expect((await parse("")).fatal).toMatch(/empty/);
    expect((await parse("﻿\r\n")).fatal).toMatch(/empty/);
  });

  it("matches header names without regard to case or spacing and accepts a semicolon file", async () => {
    const cat = await parse("Title;Authors;Series Index\nA Book;Ann Author;3\n");
    expect(cat.rows[0]).toMatchObject({ title: "A Book", authors: ["Ann Author"] });
  });

  it("copes with ragged rows", async () => {
    const cat = await parse("title,authors,isbn\r\nShort row\r\nLong row,Someone,9780261102354,extra,extra\r\n");
    expect(cat.rows.map((r) => r.title)).toEqual(["Short row", "Long row"]);
    expect(cat.rows[1].isbn13).toBe("9780261102354");
  });

  it("parses 10,000 rows in chunks, yielding between them", async () => {
    const lines = ["title,authors,series,series_index,uuid,comments"];
    for (let i = 0; i < 10000; i++) lines.push(`"Book ${i}","Author ${i % 50} & Co","S${i % 80}","${(i % 9) + 0.5}","uuid-${i}","<p>Row ${i}, with ""quotes""</p>"`);
    let yields = 0;
    const progress: number[] = [];
    const cat = await parseCalibreCsv(lines.join("\r\n"), {
      yieldFn: async () => {
        yields++;
      },
      onProgress: (f) => progress.push(f),
    });
    expect(cat.rows).toHaveLength(10000);
    expect(yields).toBeGreaterThanOrEqual(19);
    expect(progress.at(-1)).toBe(1);
    expect(cat.rows.every((r) => r.error === null)).toBe(true);
  });
});

describe("field helpers", () => {
  it("splitAuthors", () => {
    expect(splitAuthors("A & B & C")).toEqual(["A", "B", "C"]);
    expect(splitAuthors("Smith, John & Doe, Jane")).toEqual(["Smith, John", "Doe, Jane"]);
    expect(splitAuthors("Tom && Jerry")).toEqual(["Tom & Jerry"]);
    expect(splitAuthors("A & a")).toEqual(["A"]);
    expect(splitAuthors("")).toEqual([]);
  });

  it("parseIdentifiers", () => {
    expect(parseIdentifiers("isbn:978,goodreads:7")).toEqual({ isbn: "978", goodreads: "7" });
    expect(parseIdentifiers("url:https://x.org/a,b,amazon:B1")).toEqual({ url: "https://x.org/a,b", amazon: "B1" });
    expect(parseIdentifiers("nonsense")).toEqual({});
  });

  it("parseSeriesIndex", () => {
    expect(parseSeriesIndex("1.0")).toBe(1);
    expect(parseSeriesIndex("2.5")).toBe(2.5);
    expect(parseSeriesIndex("0.0")).toBeNull();
    expect(parseSeriesIndex("-1")).toBeNull();
    expect(parseSeriesIndex("")).toBeNull();
    expect(parseSeriesIndex("abc")).toBeNull();
    expect(parseSeriesIndex("3,5")).toBe(3.5);
  });

  it("parseCalibreDate", () => {
    expect(parseCalibreDate("2019-03-04T00:00:00+01:00")).toBe("2019-03-04");
    expect(parseCalibreDate("0101-01-01T00:00:00+00:00")).toBeNull();
    expect(parseCalibreDate("1999")).toBe("1999");
    expect(parseCalibreDate("2001-05")).toBe("2001-05");
    expect(parseCalibreDate("not a date")).toBeNull();
    expect(parseCalibreDate("")).toBeNull();
  });

  it("cleanDescription handles markdown, HTML and nothing", () => {
    expect(cleanDescription("A [link](http://x.org) and **bold** and _em_.")).toBe("A link and bold and em.");
    expect(cleanDescription("<p>One &amp; two</p><script>alert(1)</script>")).toBe("One & two");
    expect(cleanDescription("   ")).toBeNull();
    expect(cleanDescription(undefined)).toBeNull();
  });
});
