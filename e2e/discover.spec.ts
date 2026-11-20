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

test("Discover has three tabs and opens on Series", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover");

  await expect(page.getByRole("heading", { level: 1, name: "Discover" })).toBeVisible();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText(["Series", "For you", "For both of you"]);
  await expect(page.getByRole("tab", { name: "Series" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Complete your series");
});

test("?tab= deep-links to a section, and only that section is shown", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover?tab=both");
  await expect(page.getByRole("tab", { name: "For both of you" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 2, name: "For both of you" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Complete your series" })).toHaveCount(0);

  await page.getByRole("tab", { name: "For you" }).click();
  await expect(page).toHaveURL(/tab=you/);
  await expect(page.getByRole("heading", { level: 2, name: "For you" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/tab=both/);
});

test("arrow keys move focus between tabs and Enter opens one", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover");
  await page.getByRole("tab", { name: "Series" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "For you" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Series" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/tab=you/);
});

test("each series is one row that expands to its missing volumes", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover?tab=series");
  const rows = page.locator("details");
  if (!(await rows.count())) return; // No series with gaps on this account.
  const first = rows.first();
  await expect(first).not.toHaveAttribute("open", "");
  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");
  await expect(first.getByRole("button", { name: /^Refresh /, exact: false }).or(first.getByText(/Book \d/)).first()).toBeVisible();
  // Tap targets on the expanded row are at least 44px tall.
  for (const b of await first.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await first.locator("summary").click();
  await expect(first).not.toHaveAttribute("open", "");
});

test("the series filter narrows the list", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover?tab=series");
  const rows = page.locator("details");
  const total = await rows.count();
  if (!total) return;
  await page.getByLabel("Filter series").fill("zzzzqqqq");
  await expect(rows).toHaveCount(0);
  await page.getByLabel("Filter series").fill("");
  await expect(rows).toHaveCount(total);
});

test("the series tab and the recommendation tabs explain their state instead of showing nothing", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover?tab=series");
  const series = page.getByRole("tabpanel");
  await expect(
    series
      .getByText(/No series on your shelves yet|have not been looked up yet|You have \d+ of \d+|Complete: you have all|Nothing missing|could not be loaded|series with volumes to find/)
      .first(),
  ).toBeVisible();

  for (const [tab, name] of [
    ["you", "For you"],
    ["both", "For both of you"],
  ]) {
    await page.goto(`/discover?tab=${tab}`);
    await expect(page.getByRole("tabpanel", { name })).toBeVisible();
    await expect(
      page
        .getByRole("tabpanel")
        .getByText(/Nothing chosen yet|Last updated|rated|books on your shelves|not available|second reader|Full access needed|refreshes left today|No refreshes left today/)
        .first(),
    ).toBeVisible();
  }
});

test("a refresh button, when present, shows what is left of today's cap", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover?tab=you");
  const section = page.getByRole("tabpanel");
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
