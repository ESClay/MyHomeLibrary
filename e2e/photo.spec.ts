import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/*
 * Photo recognition: upload a photo, wait through the "Reading the books..." state, review the detections.
 * Needs a signed-up user who owns or edits a library (E2E_EMAIL, E2E_PASSWORD) and a database with the
 * phase 3b migration applied, otherwise the spec skips. The model call is replaced by a canned answer, so the
 * run costs nothing and is stable; the upload to the private `scans` bucket and the scan_jobs row are real.
 * The spec never presses "Save", so it adds nothing to the library, and it clears the photo when it ends.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the photo flow.");

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "shelf.png");

const book = (title: string, author: string, isbn13: string) => ({
  title,
  subtitle: null,
  authors: [author],
  seriesName: null,
  seriesPosition: null,
  description: null,
  covers: [],
  pageCount: null,
  publishedDate: null,
  genres: [],
  isbn13,
  isbn10: null,
  ids: {},
  rating: null,
  providers: ["openlibrary"],
});

const detected = (title: string, author: string, confidence: number, index: number) => ({
  title,
  authors: [author],
  series: null,
  seriesPosition: null,
  isbn: null,
  confidence,
  kind: "spine",
  index,
});

const canned = {
  ok: true,
  dropped: 0,
  items: [
    {
      id: "p0",
      detected: detected("Pride and Prejudice", "Jane Austen", 0.95, 0),
      best: book("Pride and Prejudice", "Jane Austen", "9780141439518"),
      alternates: [book("Pride and Prejudice and Zombies", "Seth Grahame-Smith", "9781594743344")],
      via: "search",
      duplicates: [],
    },
    {
      id: "p1",
      detected: detected("Mobi Dik", "H. Melvile", 0.3, 1),
      best: null,
      alternates: [book("Moby-Dick", "Herman Melville", "9780142437247")],
      via: "none",
      duplicates: [],
    },
  ],
};

test("upload a photo, read it, review the books, then start over", async ({ page }) => {
  await page.route(/\/api\/scan\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await new Promise((r) => setTimeout(r, 800)); // long enough to see the progress state
    await route.fulfill({ json: canned });
  });

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");

  await page.goto("/add");
  await page.getByRole("link", { name: /Photograph covers/ }).click();
  await page.waitForURL("**/add/photo");
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();

  // The camera button opens the OS camera, which a browser test cannot drive: feed the library input instead.
  await page.getByLabel("Choose a photo from your library").setInputFiles(fixture);
  await expect(page.getByText("Reading the books…")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Found 2 books" })).toBeVisible();
  const rows = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Not this one" }) });
  await expect(rows).toHaveCount(2);

  // The sure match starts included, the shaky one starts skipped and says so.
  await expect(page.getByRole("checkbox", { name: /Skip Pride and Prejudice/ })).toBeChecked();
  await expect(rows.nth(1).getByText("Not sure")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save 1 book" })).toBeEnabled();

  // "Not this one" offers the alternates and a hand search.
  await rows.nth(1).getByRole("button", { name: "Not this one" }).click();
  await expect(rows.nth(1).getByRole("radio", { name: /Moby-Dick/ })).toBeVisible();
  await expect(rows.nth(1).getByRole("searchbox", { name: "Search for this book by hand" }).or(rows.nth(1).getByLabel("Search for this book by hand"))).toBeVisible();

  // Starting over clears the photo through the discard route.
  const discarded = page.waitForResponse((r) => /\/api\/scan\/[0-9a-f-]{36}\/discard/.test(r.url()));
  await page.getByRole("button", { name: "Start over" }).click();
  expect((await discarded).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();
});
