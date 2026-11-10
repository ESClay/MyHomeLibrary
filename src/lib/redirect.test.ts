import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect";

describe("safeNext", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNext("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });

  it("falls back for missing or external targets", () => {
    expect(safeNext(undefined)).toBe("/library");
    expect(safeNext("https://evil.example")).toBe("/library");
    expect(safeNext("//evil.example")).toBe("/library");
    expect(safeNext("/\\evil.example")).toBe("/library");
  });
});
