import { expect, test } from "@playwright/test";

/*
 * Photo recognition runs in the background: photos upload, one photo_scan job is queued, a worker reads them.
 * The end-to-end read needs the worker and the model, so this spec only checks the capture screen (it uploads nothing
 * and never queues a batch). The old single-photo flow is gone; the batch is covered by unit tests of the handler,
 * the queue action and the discard route.
 * Needs a signed-up user who owns or edits a library (E2E_EMAIL, E2E_PASSWORD) and a database with the
 * phase 3b migration applied, otherwise the spec skips.
 * The account must have full access (the admin page, or the access-control spec's grant step), because the photo tile and
 * /api/scan are locked without it. The spec never presses "Save", so it adds nothing to the library, and it clears the photo when it ends.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the photo flow.");

test("the photo screen takes several photos at once and says where they go", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");

  await page.goto("/add");
  await page.getByRole("link", { name: /Photograph covers/ }).click();
  await page.waitForURL("**/add/photo");
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
  await expect(page.getByLabel("Choose photos from your library")).toHaveAttribute("multiple", "");
  await expect(page.getByText(/wait for tomorrow's allowance/)).toBeVisible();
});
