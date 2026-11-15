import { describe, expect, it } from "vitest";
import { classifyScan, isIsbnBarcode, RepeatGuard, REPEAT_WINDOW_MS } from "./isbn-scan";

describe("isIsbnBarcode", () => {
  it("accepts 978 and 979 codes with a valid checksum", () => {
    expect(isIsbnBarcode("9780441172719")).toBe(true); // Dune
    expect(isIsbnBarcode("9791032305690")).toBe(true); // 979 prefix
  });
  it("rejects a bad checksum", () => {
    expect(isIsbnBarcode("9780441172718")).toBe(false);
  });
  it("rejects EAN-13 codes that are not ISBNs, even with a valid checksum", () => {
    expect(isIsbnBarcode("4006381333931")).toBe(false); // a stationery EAN
    expect(isIsbnBarcode("0012345678905")).toBe(false); // UPC-A as EAN-13
    expect(isIsbnBarcode("9770000000002")).toBe(false); // 977 = ISSN (magazines)
  });
  it("rejects wrong lengths and non-digits", () => {
    expect(isIsbnBarcode("978044117271")).toBe(false);
    expect(isIsbnBarcode("0441172717")).toBe(false); // ISBN-10 is not a barcode scan
    expect(isIsbnBarcode("97804411727X9")).toBe(false);
  });
});

describe("classifyScan", () => {
  it("returns the ISBN for a book barcode", () => {
    expect(classifyScan("9780441172719", "EAN13")).toEqual({ kind: "isbn", isbn: "9780441172719" });
  });
  it("cuts an EAN-5 or EAN-2 add-on glued to the code", () => {
    expect(classifyScan("978044117271951499")).toEqual({ kind: "isbn", isbn: "9780441172719" });
    expect(classifyScan("978044117271912")).toEqual({ kind: "isbn", isbn: "9780441172719" });
  });
  it("ignores a lone add-on symbol", () => {
    expect(classifyScan("51499", "EAN5")).toEqual({ kind: "ignore" });
    expect(classifyScan("12", "EAN2")).toEqual({ kind: "ignore" });
  });
  it("calls anything else 'other'", () => {
    expect(classifyScan("4006381333931", "EAN13")).toEqual({ kind: "other" });
    expect(classifyScan("012345678905", "UPCA")).toEqual({ kind: "other" });
    expect(classifyScan("hello")).toEqual({ kind: "other" });
  });
});

describe("RepeatGuard", () => {
  it("accepts a new code, then ignores it inside the window", () => {
    const g = new RepeatGuard();
    expect(g.check("a", 0)).toBe(true);
    expect(g.check("a", 1000)).toBe(false);
  });
  it("accepts the same code once the window has passed since it was last seen", () => {
    const g = new RepeatGuard();
    g.check("a", 0);
    expect(g.check("a", REPEAT_WINDOW_MS)).toBe(true);
  });
  it("keeps a code quiet while it stays in view (each sighting restarts the window)", () => {
    const g = new RepeatGuard();
    g.check("a", 0);
    expect(g.check("a", 2500)).toBe(false);
    expect(g.check("a", 5000)).toBe(false); // 2.5s after the last sighting
    expect(g.check("a", 8000)).toBe(true);
  });
  it("tracks codes independently", () => {
    const g = new RepeatGuard();
    g.check("a", 0);
    expect(g.check("b", 100)).toBe(true);
  });
});
