import { describe, expect, it } from "vitest";
import { isOptimizableCover } from "./cover-image";
import { coverHostRules, supabaseCoverHost } from "./cover-hosts";

const rules = coverHostRules("https://abc.supabase.co");
const ok = (u: string) => isOptimizableCover(u, rules);

describe("isOptimizableCover", () => {
  it("accepts the provider hosts", () => {
    expect(ok("https://assets.hardcover.app/edition/1/abc.jpg")).toBe(true);
    expect(ok("https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=2")).toBe(true);
    expect(ok("https://books.googleusercontent.com/books/content?id=x")).toBe(true);
    expect(ok("https://covers.openlibrary.org/b/id/123-L.jpg")).toBe(true);
  });

  it("accepts our covers bucket only on the configured Supabase host", () => {
    expect(ok("https://abc.supabase.co/storage/v1/object/public/covers/u/1.jpg")).toBe(true);
    expect(ok("https://abc.supabase.co/storage/v1/object/public/scans/u/1.jpg")).toBe(false);
    expect(ok("https://other.supabase.co/storage/v1/object/public/covers/u/1.jpg")).toBe(false);
  });

  it("rejects unknown hosts, http, bad URLs and stray query strings", () => {
    expect(ok("https://img.example/cover.jpg")).toBe(false);
    expect(ok("http://books.google.com/books/content?id=x")).toBe(false);
    expect(ok("not a url")).toBe(false);
    expect(ok("https://assets.hardcover.app/a.jpg?w=1")).toBe(false);
    expect(ok("https://books.google.com.evil.example/books/content?id=x")).toBe(false);
    expect(ok("https://books.google.com:8443/books/content?id=x")).toBe(false);
  });
});

describe("supabaseCoverHost", () => {
  it("is null for unset, local or non-https Supabase", () => {
    expect(supabaseCoverHost(undefined)).toBeNull();
    expect(supabaseCoverHost("http://127.0.0.1:54321")).toBeNull();
    expect(supabaseCoverHost("https://localhost")).toBeNull();
  });
});
