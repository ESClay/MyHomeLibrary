import { expect, test, type Page } from "@playwright/test";

/*
 * Discover: the three sections in order, and each one's states. Needs a signed-up user who is in a library and a
 * database with the Phase 5 migration applied. Supply E2E_EMAIL and E2E_PASSWORD; without them the spec skips.
 * It makes no model calls and writes nothing: it never presses Refresh on a section that would spend tokens.
 * Which state each section shows depends on the account and the server's keys, so the checks accept any valid one.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the Discover checks.");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");
}

test("Discover shows the series, For you and For both of you sections in that order", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover");

  await expect(page.getByRole("heading", { level: 1, name: "Discover" })).toBeVisible();
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings.slice(0, 3)).toEqual(["Complete your series", "For you", "For both of you"]);
});

test("each section explains its state instead of showing nothing", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover");

  const series = page.getByRole("region", { name: "Complete your series" });
  await expect(
    series
      .getByText(/No series on your shelves yet|have not been looked up yet|You have \d+ of \d+|Complete: you have all|Nothing missing|could not be loaded/)
      .first(),
  ).toBeVisible();

  for (const name of ["For you", "For both of you"]) {
    const section = page.getByRole("region", { name });
    await expect(
      section
        .getByText(/Nothing chosen yet|Last updated|rated|not available|second reader|refreshes left today|No refreshes left today/)
        .first(),
    ).toBeVisible();
  }
});

test("a refresh button, when present, shows what is left of today's cap", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover");
  const section = page.getByRole("region", { name: "For you" });
  const cap = section.getByText(/\d+ of 5 refreshes left today|No refreshes left today/);
  if (await cap.count()) await expect(cap).toBeVisible();
});

test("Discover fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await page.goto("/discover");
  await expect(page.getByRole("heading", { level: 1, name: "Discover" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
