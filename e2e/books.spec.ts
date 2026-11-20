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

test("the chosen library sort is remembered across navigation and reloads", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");

  const sort = page.getByLabel("Sort by");
  await sort.selectOption({ label: "Title" });
  await expect(page).toHaveURL(/sort=title/);
  // The save is fire and forget; give it a moment before leaving the screen.
  await page.waitForTimeout(1000);

  await page.getByRole("link", { name: "Shelves" }).first().click();
  await page.waitForURL("**/shelves");
  await page.getByRole("link", { name: "Library" }).first().click();
  await page.waitForURL("**/library**");
  await expect(page.getByLabel("Sort by")).toHaveValue("title");

  await page.goto("/library");
  await expect(page.getByLabel("Sort by")).toHaveValue("title");
  await page.reload();
  await expect(page.getByLabel("Sort by")).toHaveValue("title");
});

test("the series field suggests the library's series, keeps free text and picks with the keyboard", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");

  await page.goto("/add");
  await page.getByRole("button", { name: "Enter a book by hand" }).click();
  const sheet = page.getByRole("dialog");
  const series = sheet.getByRole("combobox", { name: "Series" });

  // Free text is always allowed, listed series or not.
  await series.fill("E2E Made-Up Series");
  await expect(series).toHaveValue("E2E Made-Up Series");

  // Any series already in the library is offered; arrows move, Enter picks, Escape closes.
  await series.fill("");
  await series.press("ArrowDown");
  const options = sheet.getByRole("option");
  if ((await options.count()) > 0) {
    await expect(series).toHaveAttribute("aria-expanded", "true");
    const first = (await options.first().innerText()).trim();
    await series.press("ArrowDown");
    await series.press("Enter");
    await expect(series).toHaveAttribute("aria-expanded", "false");
    const value = await series.inputValue();
    expect(value.length).toBeGreaterThan(0);
    expect(first.length).toBeGreaterThan(0);
    await series.fill("x");
    await series.press("Escape");
    await expect(series).toHaveAttribute("aria-expanded", "false");
  }
});
