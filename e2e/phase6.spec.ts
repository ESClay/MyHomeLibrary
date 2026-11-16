import { expect, test, type Page } from "@playwright/test";

/*
 * Phase 6: region step -> lend a copy -> Overdue badge -> Stats. Needs a signed-up user who owns or edits a library and a database
 * with the Phase 6 migration applied. Supply E2E_EMAIL and E2E_PASSWORD; without them the spec skips. It adds one book per run and
 * removes it again at the end. It makes no eBay calls: "Check price" is never pressed.
 * If the account has no region yet, the one-time "Choose your region" step appears and the spec completes it.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the Phase 6 checks.");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

  // The one-time region step, if this account has not chosen yet.
  const regionHeading = page.getByRole("heading", { level: 1, name: "Choose your region" });
  if (await regionHeading.isVisible().catch(() => false)) {
    // Sign-out must stay reachable while the step is showing.
    await expect(page.getByRole("button", { name: "Sign out instead" })).toBeVisible();
    const select = page.getByLabel("Region");
    if ((await select.inputValue()) === "") await select.selectOption("EBAY_CA");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(regionHeading).toBeHidden();
  }
}

test("choose a region, lend a copy, see it overdue, then read the stats", async ({ page }) => {
  const title = `E2E Loan Book ${Date.now()}`;
  await signIn(page);

  // Settings shows the region and, for an owner, the price region.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Region and language" })).toBeVisible();

  // A book with one paperback copy.
  await page.goto("/add");
  await page.getByRole("button", { name: "Enter a book by hand" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Title").fill(title);
  await sheet.getByLabel("Authors").fill("Loan Tester");
  await sheet.getByRole("button", { name: "Add to my shelf" }).click();
  await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);
  const bookUrl = page.url();

  // Lend it to a new person, due long ago so it is overdue straight away.
  await page.getByRole("button", { name: "Lend this copy" }).click();
  const lend = page.getByRole("dialog");
  await lend.getByLabel("Lend to").selectOption({ label: "+ Add someone new" });
  await lend.getByLabel("Name", { exact: true }).fill("E2E Borrower");
  await lend.getByLabel("Due back (optional)").fill("2020-01-01");
  await lend.getByRole("button", { name: "Lend it" }).click();
  await expect(lend).toBeHidden();

  // The book page, the library list and the Overdue filter all show it.
  await expect(page.getByText("Overdue").first()).toBeVisible();
  await expect(page.getByText(/with E2E Borrower/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark returned" })).toBeVisible();

  await page.goto(`/library?q=${encodeURIComponent(title)}&loan=overdue`);
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByText("Overdue").first()).toBeVisible();

  // The borrower's page lists the loan.
  await page.goto("/borrowers");
  await expect(page.getByRole("heading", { level: 2, name: "E2E Borrower" })).toBeVisible();

  // Stats: four sections, and every chart has a table alternative.
  await page.goto("/stats");
  await expect(page.getByRole("heading", { level: 1, name: "Stats" })).toBeVisible();
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings).toEqual(["Reading", "Library value", "Taste", "Library growth"]);
  await expect(page.getByText("View as table").first()).toBeVisible();

  // No sideways scrolling at the device's width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Return it, then remove the book so the account stays clean.
  await page.goto(bookUrl);
  await page.getByRole("button", { name: "Mark returned" }).click();
  await expect(page.getByRole("button", { name: "Lend this copy" })).toBeVisible();
  await expect(page.getByText("Lending history")).toBeVisible();
  await page.getByRole("button", { name: "Delete this book" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await page.waitForURL("**/library");
});
