import { expect, test, type Page } from "@playwright/test";

/*
 * Shelves: create a shelf, put a book on it from the book's page, see it on /shelves, then reorder rows.
 * Needs a signed-up user who owns or edits a library, and a database with the Phase 4 migration applied.
 * Supply E2E_EMAIL and E2E_PASSWORD; without them the spec skips. It writes two shelves and one book per run.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the shelves flow.");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");
}

async function newShelf(page: Page, name: string) {
  await page.getByRole("button", { name: "New shelf" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByRole("button", { name: "Create shelf" }).click();
  await expect(sheet).toBeHidden();
}

test("create a shelf, add a book from its page, see it on Shelves and reorder the rows", async ({ page }) => {
  const stamp = Date.now();
  const first = `E2E Shelf A ${stamp}`;
  const second = `E2E Shelf B ${stamp}`;
  const title = `E2E Shelf Book ${stamp}`;

  await signIn(page);

  // A book to put on a shelf.
  await page.goto("/add");
  await page.getByRole("button", { name: "Enter a book by hand" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Title").fill(title);
  await add.getByLabel("Authors").fill("Test Author");
  await add.getByRole("button", { name: "Add to my shelf" }).click();
  await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);

  // Two shelves, made from the Shelves page.
  await page.goto("/shelves");
  await newShelf(page, first);
  await newShelf(page, second);
  await expect(page.getByRole("heading", { level: 2, name: first })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: second })).toBeVisible();

  // Back to the book, and add it to the first shelf from the picker.
  await page.goto(`/library?q=${encodeURIComponent(title)}`);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Add to shelf" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: new RegExp(first) }).click();
  await picker.getByRole("button", { name: /^Add to 1 shelf$/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole("link", { name: new RegExp(first) })).toBeVisible();

  // The shelf's row on /shelves shows the cover and a count of one.
  await page.goto("/shelves");
  const row = page.locator("section", { has: page.getByRole("heading", { level: 2, name: first }) });
  await expect(row.getByText("1 book")).toBeVisible();
  await expect(row.getByRole("link", { name: title })).toBeVisible();

  // Reorder: move the second shelf above the first in Arrange mode, and keep it after a reload.
  const names = async () => (await page.getByRole("heading", { level: 2 }).allTextContents()).filter((t) => t === first || t === second);
  expect(await names()).toEqual([first, second]);
  await page.getByRole("button", { name: "Arrange" }).click();
  await page.getByRole("button", { name: `Move ${second} up` }).click();
  await expect(page.getByRole("status").filter({ hasText: /moved to position/ })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  expect(await names()).toEqual([second, first]);

  await page.reload();
  expect(await names()).toEqual([second, first]);
});
