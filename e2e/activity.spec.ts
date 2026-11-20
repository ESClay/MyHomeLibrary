import { expect, test, type Page } from "@playwright/test";

/*
 * Activity: the page renders, and shows its empty state or its jobs. Needs a signed-up user who is in a library;
 * supply E2E_EMAIL and E2E_PASSWORD or the spec skips. Read-only: it never queues a lookup or presses Undo.
 * Before the jobs migration is applied the page still loads (empty); the badge and review checks then skip.
 * E2E_EXPECT_UNSEEN_JOB=1 says the account has a finished, unseen job, which turns on the badge check.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the Activity checks.");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");
}

test("Activity renders with its heading, and is in the navigation", async ({ page }) => {
  await signIn(page);
  await page.goto("/activity");
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Activity/ }).first()).toHaveAttribute("aria-current", "page");
  // Either nothing has run, or there are jobs: one of the two states is always on screen.
  const empty = page.getByRole("heading", { level: 2, name: "Nothing has run yet" });
  const finished = page.getByRole("heading", { level: 2, name: "Finished" });
  const running = page.getByRole("heading", { level: 2, name: "Running" });
  await expect(empty.or(finished).or(running).first()).toBeVisible();
});

test("a review link opens the series review when a finished lookup exists", async ({ page }) => {
  await signIn(page);
  await page.goto("/activity");
  const review = page.getByRole("link", { name: "Review changes" }).first();
  test.skip((await review.count()) === 0, "No finished series lookup on this account yet.");
  await review.click();
  await expect(page.getByRole("heading", { level: 2, name: "Series review" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Filter changes" })).toBeVisible();
});

test("the nav badge counts finished jobs that have not been opened", async ({ page }) => {
  test.skip(!process.env.E2E_EXPECT_UNSEEN_JOB, "Needs an account with a finished, unseen job (E2E_EXPECT_UNSEEN_JOB=1).");
  await signIn(page);
  await page.goto("/library");
  await expect(page.getByRole("navigation", { name: "Primary" }).getByText(/finished, not yet reviewed/).first()).toBeAttached();
});
