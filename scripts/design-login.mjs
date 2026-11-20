// Signs the e2e TEST user into a Chrome profile folder, so the design-taste-frontend skill's own
// headless checks (which launch their own Chrome with --profile) can open the signed-in pages.
//
//   E2E_EMAIL=... E2E_PASSWORD=... npm run design:login [-- --profile .taste-skill/chrome-check] [--base http://localhost:3000]
//
// Credentials come only from the environment. They are never printed or stored by this script;
// the resulting session cookie lives in the profile folder, which is git-ignored (.taste-skill/).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf("--" + k);
  return i < 0 ? d : args[i + 1];
};

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
if (!email || !password) {
  console.error("design-login: set E2E_EMAIL and E2E_PASSWORD (the e2e test account) in the environment, then run again.");
  process.exit(1);
}

const base = new URL(opt("base", "http://localhost:3000"));
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  console.error("design-login: only the local dev server is allowed (localhost or 127.0.0.1).");
  process.exit(1);
}

const profile = path.resolve(opt("profile", ".taste-skill/chrome-check"));
const taste = path.resolve(".taste-skill");
if (profile !== taste && !profile.startsWith(taste + path.sep)) {
  console.error("design-login: the profile must live inside .taste-skill/ (git-ignored).");
  process.exit(1);
}
fs.mkdirSync(profile, { recursive: true });

// Same Chrome the skill's scripts pick (CHROME_PATH first, then the usual install paths).
const executablePath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && fs.existsSync(p));
if (!executablePath) {
  console.error("design-login: no Chrome found (set CHROME_PATH), the same one the skill's scripts use.");
  process.exit(1);
}

// The skill launches Chrome without --password-store=basic / --use-mock-keychain, so drop
// Playwright's defaults for them; otherwise the cookie encryption would not match on Linux.
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  ignoreDefaultArgs: ["--password-store=basic", "--use-mock-keychain"],
});
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(new URL("/sign-in", base).href);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library", { timeout: 30000 });
  console.log(`design-login: signed in; session saved in ${path.relative(process.cwd(), profile)}`);
} catch {
  console.error("design-login: sign-in did not reach /library (wrong credentials, or the dev server is not up).");
  process.exitCode = 1;
} finally {
  await context.close();
}
