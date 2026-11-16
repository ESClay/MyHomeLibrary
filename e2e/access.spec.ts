import { expect, test, type Page } from "@playwright/test";

/*
 * Access control: an account without full access sees locked features and Open Library only; an admin grants it on /admin and the
 * features unlock. It makes no Claude, eBay, Hardcover or Google calls and writes nothing but the one entitlement it toggles.
 *
 * Needs two accounts on a database with the access-control migration applied:
 *   E2E_EMAIL / E2E_PASSWORD         an ordinary account in a library it can edit, which must NOT have full access when the run starts
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD   an app admin (a row in app_admins)
 * Without all four the spec skips. It revokes the ordinary account's access again at the end, so a rerun starts the same way.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

test.skip(!email || !password || !adminEmail || !adminPassword, "Set E2E_EMAIL, E2E_PASSWORD, E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the access checks.");
// The grant is shared state, so the steps run in order on one worker.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  const regionHeading = page.getByRole("heading", { level: 1, name: "Choose your region" });
  if (await regionHeading.isVisible().catch(() => false)) {
    const select = page.getByLabel("Region");
    if ((await select.inputValue()) === "") await select.selectOption("EBAY_CA");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(regionHeading).toBeHidden();
  }
}

const ordinary = () => ({ email: email!, password: password! });
const admin = () => ({ email: adminEmail!, password: adminPassword! });

async function setAccess(page: Page, who: string, on: boolean) {
  await page.goto("/admin");
  await page.getByLabel("Search by name or email").fill(who);
  const row = page.getByTestId("account-row").filter({ hasText: who }).first();
  await expect(row).toBeVisible();
  const toggle = row.getByRole("switch");
  if ((await toggle.getAttribute("aria-checked")) !== String(on)) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", String(on));
  }
}

test("without full access the paid features are locked", async ({ page }) => {
  await signIn(page, ordinary());

  await page.goto("/add");
  const tile = page.locator('[data-locked="photo"]');
  await expect(tile).toBeVisible();
  await expect(tile).toContainText("Full access needed");
  await expect(page.getByRole("link", { name: /Photograph covers/ })).toHaveCount(0);
  await expect(page.getByTestId("open-only-note")).toContainText("Open Library only");

  await page.goto("/add/photo");
  await expect(page.getByText("Full access needed").first()).toBeVisible();

  await page.goto("/discover");
  await expect(page.getByRole("region", { name: "For you" }).getByText("Full access needed")).toBeVisible();
  await expect(page.getByRole("button", { name: /Refresh|Find books/ })).toHaveCount(0);

  // The admin page does not exist for an ordinary account.
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
});

test("an admin grants full access and the features unlock", async ({ page }) => {
  await signIn(page, admin());
  await setAccess(page, email!, true);

  await page.context().clearCookies();
  await signIn(page, ordinary());
  await page.goto("/add");
  await expect(page.getByRole("link", { name: /Photograph covers/ })).toBeVisible();
  await expect(page.locator('[data-locked="photo"]')).toHaveCount(0);
  await expect(page.getByTestId("open-only-note")).toHaveCount(0);

  await page.goto("/discover");
  await expect(page.getByRole("region", { name: "For you" }).getByText("Full access needed")).toHaveCount(0);
});

test("the admin revokes it again", async ({ page }) => {
  await signIn(page, admin());
  await setAccess(page, email!, false);

  await page.context().clearCookies();
  await signIn(page, ordinary());
  await page.goto("/add");
  await expect(page.locator('[data-locked="photo"]')).toBeVisible();
});
