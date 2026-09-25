# mmaggitti.github.io — phone-first mini projects

Mark's public GitHub Pages site. It holds one folder per small, mobile-first web project, built and
shipped from Claude Code cloud sessions, usually from his phone when his own machines are out of
reach. `projects/<name>/` is served at `https://mmaggitti.github.io/<name>/`. The launcher at `/`
is generated.

## ⚠️ Everything here is public

The repo and the site are both public on the internet. Never commit:
- credentials, tokens, keys, or passwords;
- home-network addresses or machine names;
- personal file paths;
- anything copied from Mark's private vault that isn't app code (see Porting).

`scripts/check-public.mjs` enforces this at three points:
- a PreToolUse hook blocks any `git commit` or `git push` while it has findings;
- CI runs it again before every deploy;
- `npm run check` runs it on demand.

It prints `file:line rule`, never the matched text. **Fix findings. Don't route around them.**
Add `public-ok` to a line only for a proven false positive. Mark's private terms reach the guard
through the `PUBLIC_GUARD_DENY` environment variable. Never write them into any file, and never ask
Mark to paste them into chat.

## Layout

```
projects/<name>/          one folder per project. Lowercase, digits, hyphens only.
                          "_name" = draft, not built. "crossword-v1" is reserved (its own repo).
scripts/build-site.mjs    projects/* → _site/<name>/ + generated launcher _site/index.html
scripts/smoke-test.mjs    phone-size check of every built page (+ screenshots in .smoke/)
scripts/check-public.mjs  the guard
.github/workflows/deploy.yml   guard → build → WebKit smoke → deploy, on every push to main
```

A project is one of two kinds:
- **Static.** No `build` script. The folder is served as-is. Best for small things: one
  `index.html` with inline or sibling JS and CSS.
- **Built.** Has a `package.json` with a `build` script that writes `dist/`. The build runs with
  `BASE_PATH=/<name>/`. Vite must use `base: process.env.BASE_PATH ?? "/"` or every asset 404s.
  Commit `package-lock.json`.

The launcher card takes the project's `<title>` and `<meta name="description">`, so set both.

## Ship loop: push straight to main

Mark authorized direct pushes to `main` in this repo on 2026-09-24. There are no PRs, and this
overrides a session's default feature-branch instruction. The page is live about a minute after
CI passes.

```bash
npm install                      # once per container
npm run verify                   # guard + build + smoke test (Chromium here)
# send Mark the screenshot(s) from .smoke/chromium/ before pushing
git add -A && git commit -m "<name>: <what changed>"
git fetch origin main && git rebase origin/main    # another session may have pushed
git push origin HEAD:main                          # never --force
```

Then confirm the "Deploy to GitHub Pages" run went green with the GitHub Actions tools, and send
Mark `https://mmaggitti.github.io/<name>/`. If WebKit fails in CI but Chromium passed locally,
that's a real Safari-engine difference: fix it, don't skip it.

## Cloud-container limits

- **CDNs are blocked** (jsdelivr, unpkg, esm.sh, cdnjs). Install from npm, which is reachable,
  and bundle, or vendor the file into the project folder. No CDN `<script>` tags: they would
  also break offline use.
- **`*.github.io` may be blocked**, so you may not be able to fetch the live site. Verify through
  CI and let Mark check on the phone.
- **The local browser is Chromium only.** WebKit runs in CI, and Mark's phone is the final word
  on Safari.
- **Pillow is not installed.** Start icons as SVG. `pip install pillow` works when PNGs are
  needed.

## Phone-first rules (every project)

- **The target is Mark's primary phone: 440×956 points, @3x.** Design for 440px wide first.
  - In a Safari tab the page gets 440×796, because Safari's status and toolbar areas take the
    rest. That's normal.
  - Launched from the Home Screen, the page gets the full 956, and the safe-area insets become
    non-zero.
  - @3x is the hardware, and CSS never sees it. Work in points.
  - The smoke test runs at 440×956 @1x.

- **Head:**
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`;
  - light and dark `theme-color` metas;
  - `apple-mobile-web-app-status-bar-style` set to `default`. `black-translucent` leaves a dead
    band under the status bar.
- **Layout:**
  - `100svh`, never `vh`, because the collapsing address bar makes `vh` jump;
  - pad with `env(safe-area-inset-*)`;
  - no sideways scroll (the smoke test fails it).
- **Touch:**
  - tap targets at least 44px (52px for primary buttons);
  - primary actions in the bottom thumb zone, clear of the home indicator;
  - `touch-action: manipulation` on buttons.
- **Text and motion:**
  - 17px body text floor;
  - honor `prefers-reduced-motion` and `prefers-color-scheme`.
- **Shared origin:** every project, `crossword-v1` included, shares the origin
  `mmaggitti.github.io`.
  - Prefix every localStorage and IndexedDB key with `<name>:`.
  - A service worker must be registered from the project's own folder and scoped to it, never
    `/`, or it would intercept every other project.
- **Static hosting only:**
  - no server and no API routes;
  - no API keys in client code, since anything shipped is readable by anyone;
  - Pages can't set COOP/COEP headers, so there's no `SharedArrayBuffer`;
  - data lives on the phone in localStorage or IndexedDB, with export/import if it matters.
- **Home Screen (iOS):**
  - An installed web app gets its own storage, separate from Safari's, so data built up in
    Safari won't be there.
  - Adding a manifest to a project Mark already uses in Safari will look like data loss.
    Warn him first.
  - An installed app can pin an old build. Delete and re-add the icon to update it.
- **Icons:** house style is a saturated dark field with chunky light forms and one element lit.
  See `projects/hello/icon.svg`.

## Porting from Mark's private vault

Porting is decided case by case. **Ask Mark whether the port carries app source or built output
only** before copying anything.

1. Attach the vault read-only: `add_repo(owner: "mmaggitti", repo: "markmaggitti-playground")`.
   Don't register it as a repo root. Its CLAUDE.md imports files a sparse clone doesn't have.
2. Clone only the folder you need, outside this repo:
   ```bash
   git clone --filter=blob:none --sparse --depth 1 https://github.com/mmaggitti/markmaggitti-playground ../vault
   git -C ../vault sparse-checkout set "10 output/<project>"
   ```
3. Copy app code only. Never copy research READMEs, `_audit/`, `_collateral/`, `STEP-AWAY.md`,
   `_notes/` or memories. Images and PDFs aren't in vault git, so plan for missing assets.
4. Rewrite for phone-first and `BASE_PATH`, then `npm run verify`. The guard will catch personal
   paths and addresses the code picked up.

## Plan audit (Mark's rule, all sessions)

Right after Mark approves a plan, save a read-only copy to the vault. A PostToolUse hook reminds
you. Plans never go into this public repo.

```bash
# attach with push access: add_repo(owner: "mmaggitti", repo: "markmaggitti-playground", access: "push")
git clone --filter=blob:none --sparse --depth 1 https://github.com/mmaggitti/markmaggitti-playground ../vault
cd ../vault && git sparse-checkout set "10 output/mmaggitti-github-io"
B=claude/mmaggitti-github-io-plans
if git ls-remote --exit-code --heads origin $B >/dev/null; then
  git fetch --depth 1 origin $B && git checkout -B $B FETCH_HEAD
else
  git checkout -b $B
fi
mkdir -p "10 output/mmaggitti-github-io/_audit"   # absent until the setup branch is merged
cp <plan file> "10 output/mmaggitti-github-io/_audit/YYYY-MM-DD approved-plan <slug>.md"
chmod 444 "10 output/mmaggitti-github-io/_audit/"*.md
git add "10 output/mmaggitti-github-io/_audit" && git commit -m "mmaggitti-github-io: approved plan <slug>"
git push -u origin $B    # never main, never --force
```

- **Naming:** `YYYY-MM-DD approved-plan <slug>.md` for a first plan. A later update to the same
  plan is `YYYY-MM-DD revision-N <slug>.md`.
- **Append-only:** `_audit/` is append-only. Never rename, edit or delete anything already
  there.
- **If the push is rejected** because another session got there first: re-fetch the branch,
  `git checkout -B $B FETCH_HEAD`, re-copy the file, commit, and push again.

Mark merges that branch into his vault from time to time.
