import { describe, expect, it } from "vitest";
import { stripHtml } from "./html";

describe("stripHtml", () => {
  it("removes tags, decodes entities and keeps paragraph breaks", () => {
    expect(stripHtml("<p>One &amp; <b>two</b></p><p>Three<br>four</p>")).toBe("One & two\n\nThree\nfour");
  });
  it("drops scripts and styles with their bodies", () => {
    expect(stripHtml("Hi<script>alert(1)</script><style>p{}</style>!")).toBe("Hi!");
  });
  it("does not let escaped markup through", () => {
    expect(stripHtml("&lt;img src=x onerror=alert(1)&gt;ok")).toBe("ok");
  });
  it("returns null for empty input", () => {
    expect(stripHtml("  <p> </p> ")).toBeNull();
    expect(stripHtml(null)).toBeNull();
  });
});
