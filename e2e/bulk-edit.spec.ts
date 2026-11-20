import { expect, test, type Page } from "@playwright/test";

/*
 * Library bulk edit: select three books, set My status to Read, then set a condition on a mix of single- and
 * multi-copy books and read the skip message.
 * Supply E2E_EMAIL and E2E_PASSWORD (an owner or editor); without them the spec skips. It writes four books per run.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the bulk edit flow.");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");
}

async function addBook(page: Page, title: string, extraCopies: number) {
  await page.goto("/add");
  await page.getByRole("button", { name: "Enter a book by hand" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Title").fill(title);
  await add.getByLabel("Authors").fill("Bulk Tester");
  await add.getByRole("button", { name: "Add to my shelf" }).click();
  await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);
  for (let i = 0; i < extraCopies; i++) {
    await page.getByRole("button", { name: /add (a )?copy/i }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: /^(add|save)/i }).last().click();
    await expect(sheet).toBeHidden();
  }
}

test("bulk set status, then condition with multi-copy books skipped", async ({ page }) => {
  const stamp = Date.now();
  const titles = [`E2E Bulk A ${stamp}`, `E2E Bulk B ${stamp}`, `E2E Bulk C ${stamp}`];
  await signIn(page);
  await addBook(page, titles[0], 0);
  await addBook(page, titles[1], 0);
  await addBook(page, titles[2], 1);

  await page.goto(`/library?q=${encodeURIComponent(`E2E Bulk`)}&view=list`);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select shown" }).click();

  await page.getByRole("button", { name: "Edit selected" }).click();
  let sheet = page.getByRole("dialog");
  await sheet.getByLabel("My status").selectOption({ label: "Read" });
  await sheet.getByRole("button", { name: /^Apply to/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Read").first()).toBeVisible();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select shown" }).click();
  await page.getByRole("button", { name: "Edit selected" }).click();
  sheet = page.getByRole("dialog");
  await sheet.getByLabel("Condition").selectOption({ label: "Good" });
  await sheet.getByRole("button", { name: /^Apply to/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(/Skipped 1 with more than one copy/)).toBeVisible();
});

test("Mark as read sets the status from the action bar", async ({ page }) => {
  const title = `E2E Bulk Read ${Date.now()}`;
  await signIn(page);
  await addBook(page, title, 0);

  await page.goto(`/library?q=${encodeURIComponent(title)}&view=list`);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const mark = page.getByRole("button", { name: "Mark as read" });
  await expect(mark).toBeDisabled();
  await page.getByRole("button", { name: "Select shown" }).click();
  await mark.click();
  await expect(page.getByText("Marked 1 book as read.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as read" })).toBeHidden();
});
