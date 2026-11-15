import { expect, test } from "@playwright/test";

/*
 * Barcode scan tray, via the manual ISBN field (a camera cannot be driven here).
 * Needs a signed-up user who owns or edits a library: supply E2E_EMAIL and E2E_PASSWORD, otherwise the
 * spec skips. It only reaches the review screen and never saves, so it writes nothing to the library.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the scan flow.");

const ISBN = "9780441172719";

test("type an ISBN, see it in the tray, open the review", async ({ page, context }) => {
  // No real camera in CI: refuse it so the page shows its fallback, as it would for a denied permission.
  await context.clearPermissions();

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");

  await page.goto("/add");
  await page.getByRole("link", { name: /Scan barcodes/ }).click();
  await page.waitForURL("**/add/scan");
  await expect(page.getByRole("group", { name: "Barcode viewfinder" })).toBeVisible();

  // On a phone the manual field sits behind the keyboard button (it opens by itself when the camera fails).
  const field = page.getByLabel("Or type the ISBN");
  if (!(await field.isVisible())) {
    const toggle = page.getByRole("button", { name: "Type an ISBN instead" });
    if (await toggle.isVisible()) await toggle.click();
  }

  // A bad ISBN is refused with a message and adds nothing.
  await field.fill("9780441172718");
  await page.getByRole("button", { name: "Add to tray" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "valid ISBN" })).toBeVisible();

  // A good one lands in the tray.
  await field.fill(ISBN);
  await page.getByRole("button", { name: "Add to tray" }).click();
  const review = page.getByRole("button", { name: /^Review 1 book$/ });
  await expect(review).toBeVisible();

  // Typing the same ISBN again does not add a second entry.
  await field.fill(ISBN);
  await page.getByRole("button", { name: "Add to tray" }).click();
  await expect(page.getByText("That book is already in your tray.")).toBeVisible();
  await expect(review).toBeVisible();

  // The tray survives a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Review 1 book$/ })).toBeVisible();

  // The review screen opens with the bulk settings and the book.
  await page.getByRole("button", { name: /^Review 1 book$/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Review 1 book" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "For all books" })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "On my shelf" })).toBeChecked();
  await expect(sheet.getByLabel("Format").first()).toBeVisible();

  // Take the book out again so reruns start clean.
  await sheet.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /^Tray/ }).click(); // opens the list on a phone, harmless on desktop
  await page.getByRole("button", { name: /^Remove .* from the tray$/ }).first().click();
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeDisabled();
});
