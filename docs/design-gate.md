# Running the design gate on signed-in pages

The `design-taste-frontend` scripts start their own headless Chrome, which has no session, so app
pages redirect to `/sign-in`. `scripts/design-login.mjs` signs the e2e VIEWER test account into a
Chrome profile folder that `shoot.mjs` then reuses.

Google Chrome is installed at `/usr/bin/google-chrome`; the scripts find it on their own (set
`CHROME_PATH` to override). The dev server must be running (`npm run dev`, http://localhost:3000).

## 1. Sign in (once per profile, repeat if the session expires)

```bash
node --env-file=.env.local scripts/design-login.mjs   # profile: .taste-skill/chrome-check
```

`.env.local` holds `E2E_EMAIL` and `E2E_PASSWORD`. Load it with `--env-file`. Never `source` it (one
value contains shell-special characters) and never print its values. The script refuses any host other
than localhost, and the profile must sit inside `.taste-skill/` (git-ignored).

If the profile is already signed in, `/sign-in` redirects to `/library` and the script reports that it
did not reach `/library`. That is harmless: shoot a page and check it shows the app, not the sign-in page.
Do not run two scripts on the same profile at once (Chrome locks it).

## 2. Check a page

```bash
S=~/.claude/skills/design-taste-frontend
node $S/scripts/shoot.mjs --url http://localhost:3000/library --w 390 --out .taste-skill/shots/library-390.png --profile .taste-skill/chrome-check
```

Shoot each page at `--w 1440` and `--w 390`. Open every PNG and confirm it shows the app page.

What does not work on app pages:

- `assets/layout/check.mjs` crashes: it expects `main > section` markup.
- `scripts/consistency.mjs` ignores `--profile` and checks `/sign-in` instead of the page.
- `gate.mjs --start` gives each check a fresh profile folder, so it never inherits the login.

So for app pages the gate is `shoot.mjs` screenshots plus a hand check against the app-screen rules:
44px tap targets (inputs, buttons, sheet close), a visible focus ring on every control, one system
(the app's own look, no violet), plain copy, a `role="status"` line for async state, no sideways scroll
at 390. `consistency.mjs` and `check.mjs` still work on the public pages (`/sign-in`).

## 3. Rules that do not apply to app screens

The skill is built for marketing pages. For app screens these do not apply: the hero and `hero-enter`,
one section per screen / section length, photo counts, and dealt moments (`moment-none`). When the gate
reports one as FAIL on a public page, record a waiver in `.taste-skill/waivers.json` (one per finding, a
reason of 12+ characters, at most 5 in total), as in `references/gate.md`:

```json
[{ "check": "moment-none", "target": "<where the gate prints>", "reason": "App screen: moments belong to marketing pages, not a working library list" }]
```

Never edit the skill's kit files and never change a page only to satisfy a check. Real findings (tap
size under 44px, sideways scroll, type and color consistency) are fixed, not waived.
