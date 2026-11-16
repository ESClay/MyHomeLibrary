import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/*
 * Calibre import: open the page, follow the export steps, upload the fixture catalog, map the read column
 * and reach the review screen. Needs a signed-up user who owns or edits a library (E2E_EMAIL, E2E_PASSWORD) and a
 * database with the phase 3c migration applied, otherwise the spec skips.
 * The spec never presses "Import", so it saves nothing. The fixture is the same file the parser tests use.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the Calibre import flow.");

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "calibre", "__fixtures__", "calibre-catalog.csv");

test("upload a Calibre catalog, map the read column and review the books", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");

  await page.goto("/add");
  await page.getByRole("link", { name: /Import from Calibre/ }).click();
  await page.waitForURL("**/add/import");

  // Step 1: the export steps, in Calibre's words.
  await expect(page.getByRole("heading", { name: "Export your catalog from Calibre" })).toBeVisible();
  await expect(page.getByText("Create a catalog of the books in your calibre library")).toBeVisible();
  await expect(page.getByText("Catalog format")).toBeVisible();
  await page.getByRole("button", { name: "I have the file" }).click();

  // Step 2: upload. The file input is visually hidden, so feed it directly.
  await expect(page.getByRole("heading", { name: "Choose the CSV file" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to read status" })).toBeDisabled();
  await page.locator("#calibre-file").setInputFiles(fixture);
  await expect(page.getByText("Read 9 books from calibre-catalog.csv")).toBeVisible();
  await expect(page.getByText("#read (7 filled)")).toBeVisible();
  await page.getByRole("button", { name: "Continue to read status" }).click();

  // Step 3: the read column is suggested and each distinct value can be mapped.
  await expect(page.getByRole("heading", { name: "Which column says what you have read?" })).toBeVisible();
  await expect(page.getByLabel("Read status column")).toHaveValue("#read");
  await expect(page.getByLabel("Finished date column")).toHaveValue("#finished");
  await expect(page.getByLabel("What True means")).toHaveValue("read");
  await expect(page.getByLabel("What False means")).toHaveValue("ignore");
  await page.getByLabel("What True means").selectOption("want");
  await expect(page.getByRole("status").filter({ hasText: "want to read" })).toBeVisible();
  await page.getByLabel("What True means").selectOption("read");
  await page.getByRole("button", { name: "Continue to review" }).click();

  // Step 4: review. One row per book, with counts, filters, search and select all/none.
  await expect(page.getByRole("heading", { name: "Review 9 books" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Needs attention/ })).toContainText("2");
  await expect(page.getByText("This row has no title.")).toBeVisible();
  await expect(page.getByText("Repeats the Calibre id of row 1.")).toBeVisible();

  await page.getByRole("button", { name: /Needs attention/ }).click();
  await expect(page.getByRole("checkbox", { name: /Include/ })).toHaveCount(0); // neither row can be imported

  await page.getByRole("button", { name: /^\d+\s*All$/ }).click();
  await page.getByRole("searchbox", { name: "Search this catalog" }).fill("good omens");
  await expect(page.getByRole("heading", { name: /Good Omens/ }).or(page.getByText("Good Omens").first())).toBeVisible();
  await expect(page.getByText("Read on 12 Mar 2021")).toHaveCount(0);

  await page.getByRole("searchbox", { name: "Search this catalog" }).fill("");
  await page.getByRole("button", { name: "Select none" }).click();
  await expect(page.getByRole("button", { name: "Nothing to import" })).toBeDisabled();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByRole("button", { name: /^Import \d+ books?$/ })).toBeEnabled();

  // The lookup switch changes the time estimate.
  await expect(page.getByText(/This import takes/)).toBeVisible();
  await page.getByLabel("Fill in covers and missing details").uncheck();
  await expect(page.getByText(/with no covers/)).toBeVisible();
});
