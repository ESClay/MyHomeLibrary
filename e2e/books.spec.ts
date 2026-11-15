import { expect, test } from "@playwright/test";

/*
 * Add -> detail -> rate. Needs a signed-up user who owns or edits a library, and a database
 * where the Phase 2 migration is applied. Supply E2E_EMAIL and E2E_PASSWORD; without them the
 * spec skips so CI and fresh checkouts stay green. It writes one book per run to that library.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the books flow.");

test("add a book by hand, open it, rate it and see the rating stick", async ({ page }) => {
  const title = `E2E Test Book ${Date.now()}`;

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");

  await page.goto("/add");
  await page.getByRole("button", { name: "Enter a book by hand" }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Title").fill(title);
  await sheet.getByLabel("Authors").fill("Test Author");
  await sheet.getByRole("button", { name: "Add to my shelf" }).click();

  await page.waitForURL(/\/books\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  await page.getByRole("radio", { name: "Read", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "3.5 stars" }).click();
  await expect(page.getByRole("slider", { name: "Your rating" })).toHaveAttribute("aria-valuenow", "3.5");

  await page.reload();
  await expect(page.getByRole("slider", { name: "Your rating" })).toHaveAttribute("aria-valuenow", "3.5");

  await page.goto(`/library?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test("typing in Add shows suggestions and picking an online match opens the confirm sheet", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");

  await page.goto("/add");
  const box = page.getByRole("combobox", { name: "Title, author or ISBN" });
  await box.fill("du");
  await expect(box).toHaveAttribute("aria-expanded", "false");

  await box.fill("dune herbert");
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  await expect(box).toHaveAttribute("aria-expanded", "true");

  // Keyboard: arrows move through options and focus stays in the input.
  await box.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", /-opt-0$/);
  await expect(box).toBeFocused();

  // Escape closes the list without clearing the input.
  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).toHaveValue("dune herbert");

  // Clearing hides suggestions; retyping brings them back and an online match opens the confirm sheet.
  await box.fill("");
  await expect(options).toHaveCount(0);
  await box.fill("dune herbert");
  const online = page.getByRole("group", { name: "Online matches" }).getByRole("option").first();
  await online.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
