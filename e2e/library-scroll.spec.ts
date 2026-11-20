import { expect, test, type Page } from "@playwright/test";

/*
 * Library scroll memory (#5) and the status-chip scroll cue (#7). Read-only: it only navigates.
 * The scroll test needs a library of more than ~100 books. Supply E2E_EMAIL and E2E_PASSWORD; without them the spec skips.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run the library scroll flows.");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");
}

/** Scrolls until at least `count` books are listed, then returns the book link nearest the middle of the screen. */
async function scrollPast(page: Page, count: number) {
  const links = page.locator('a[href^="/books/"]');
  for (let i = 0; i < 40 && (await links.count()) < count; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(250);
  }
  expect(await links.count(), "library has enough books to page").toBeGreaterThanOrEqual(count);
  return page.evaluate(() => {
    const mid = window.innerHeight / 2;
    const all = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/books/"]')];
    const a = all.reduce((best, el) => (Math.abs(el.getBoundingClientRect().top - mid) < Math.abs(best.getBoundingClientRect().top - mid) ? el : best));
    return { href: a.getAttribute("href")!, top: Math.round(a.getBoundingClientRect().top), y: Math.round(window.scrollY), url: location.search };
  });
}

async function expectBackAt(page: Page, mark: { href: string; top: number; y: number; url: string }) {
  await page.waitForURL(/\/library/);
  expect(new URL(page.url()).search).toBe(mark.url);
  const link = page.locator(`a[href="${mark.href}"]`);
  await expect(link).toBeVisible();
  await expect.poll(async () => Math.abs((await link.boundingBox())!.y - mark.top), { timeout: 5000 }).toBeLessThan(40);
}

test.describe("library scroll memory", () => {
  test("the back link and browser Back both land on the same row with the same sort", async ({ page }) => {
    await signIn(page);
    await page.goto("/library?sort=title&dir=desc");
    const mark = await scrollPast(page, 110);
    expect(mark.y).toBeGreaterThan(1000);

    await page.locator(`a[href="${mark.href}"]`).click();
    await page.waitForURL(/\/books\//);
    await page.getByRole("article").getByRole("link", { name: "Library" }).click();
    await expectBackAt(page, mark);

    await page.locator(`a[href="${mark.href}"]`).click();
    await page.waitForURL(/\/books\//);
    await page.goBack();
    await expectBackAt(page, mark);
  });

  test("a book opened with no library before it links to the library", async ({ page }) => {
    await signIn(page);
    await page.goto("/library");
    const href = await page.locator('a[href^="/books/"]').first().getAttribute("href");
    await page.goto(href!); // A fresh load: nothing in this tab left the library by a click.
    await expect(page.getByRole("article").getByRole("link", { name: "Library" })).toHaveAttribute("href", /^\/library/);
  });
});

test.describe("status chips scroll cue", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows a cue at the start and drops it at the end of the row", async ({ page }) => {
    await signIn(page);
    await page.goto("/library");
    const row = page.getByRole("group", { name: "My reading status" });
    const cue = row.locator("xpath=..").locator("button[aria-hidden='true']");
    await expect(cue).toBeVisible();
    const box = (await cue.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await cue.click();
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(cue).toBeHidden();
  });

  test("the view toggle buttons are 44px", async ({ page }) => {
    await signIn(page);
    await page.goto("/library");
    const btn = page.getByRole("button", { name: "Cover grid" });
    const box = (await btn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});
