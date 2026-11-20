import { expect, test, type Page } from "@playwright/test";

/*
 * Merge books (#6) and the duplicate warning on add. Needs an owner or editor account: it creates two throwaway books
 * with one title and merges them. It skips when E2E_EMAIL / E2E_PASSWORD are missing, and when the signed-in account
 * cannot see the Merge button (a viewer). It never merges books it did not create.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the merge flow.");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");
}

test("select two books, merge them, and one book with both copies remains", async ({ page }) => {
  await signIn(page);

  // A viewer has no Merge button: probe with two books already on screen, changing nothing.
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const links = page.locator('a[href^="/books/"]');
  await expect(links.first()).toBeVisible();
  await links.nth(0).click();
  await links.nth(1).click();
  const canMerge = await page.getByRole("button", { name: "Merge", exact: true }).isVisible();
  test.skip(!canMerge, "This account cannot merge (viewer): use an owner or editor.");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  const title = `E2E Merge Book ${Date.now()}`;
  for (let n = 0; n < 2; n++) {
    await page.goto("/add");
    await page.getByRole("button", { name: "Enter a book by hand" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Title").fill(title);
    await sheet.getByLabel("Authors").fill("Merge Tester");
    await sheet.getByRole("button", { name: "Add to my shelf" }).click();
    if (n === 1) {
      // The second one is the duplicate warning: it offers an update, or a new book.
      await expect(sheet.getByRole("button", { name: "Update the book you have" })).toBeVisible();
      await sheet.getByRole("button", { name: "Add as a new book" }).click();
    }
    await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);
  }

  await page.goto(`/library?q=${encodeURIComponent(title)}`);
  await expect(page.locator('a[href^="/books/"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.locator('a[href^="/books/"]').nth(0).click();
  await page.locator('a[href^="/books/"]').nth(1).click();
  await page.getByRole("button", { name: "Merge", exact: true }).click();

  const sheet = page.getByRole("dialog", { name: "Merge books" });
  await expect(sheet.getByRole("radio", { name: /^Keep / })).toHaveCount(2);
  await expect(sheet.getByText("1 copy moves to")).toBeVisible();
  await sheet.getByRole("button", { name: "Merge 2 books" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Merged 2 books" })).toBeVisible();
  await expect(page.locator('a[href^="/books/"]')).toHaveCount(1);
  await page.locator('a[href^="/books/"]').first().click();
  await expect(page.getByText("2 copies").first()).toBeVisible();
});
