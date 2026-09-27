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
                          "_name" = draft, not built. Reserved: "crossword-v1" (its own repo), "ds".
projects/<name>/test/e2e.mjs   optional end-to-end test; npm test runs it (see Testing)
projects/studio/          the live-DOM studio, a tool rather than a mini project (see Studio)
projects/svg-lab/         Mark's SVG Lab (static, one file); vendors DOMPurify and its fonts (see its e2e)
projects/draw/            Draw, the SVG editor (Vite + React + TS); unlisted until Release 1 (see Draw)
engine/                   Draw's SVG engine: DOM-free, dependency-free TS, tested with node --test
scripts/lib/              rules shared by CI and Draw: public-rules (the guard), svg-profile (served SVG)
scripts/check-library.mjs every served .svg is inert; the library holds only allowed files (see Draw)
ds/ds.css                 the design system (served at /ds/ds.css); specimen page at /ds/
scripts/build-site.mjs    projects/* → _site/<name>/, ds/ → _site/ds/, generated launcher, pages.json
scripts/smoke-test.mjs    phone-size check of every built page (+ screenshots in .smoke/)
scripts/check-public.mjs  the guard
scripts/check-units.mjs   rem, not px (see Design system)
.github/workflows/deploy.yml   guard → units → build → WebKit smoke → deploy, on every push to main
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
npm run verify                   # guard + units + build + smoke test (Chromium here)
# send Mark the screenshot(s) from .smoke/chromium/ before pushing
git add -A && git commit -m "<name>: <what changed>"
git fetch origin main && git rebase origin/main    # another session may have pushed
git push origin HEAD:main                          # never --force
```

Then confirm the "Deploy to GitHub Pages" run went green with the GitHub Actions tools, and send
Mark `https://mmaggitti.github.io/<name>/`. If WebKit fails in CI but Chromium passed locally,
that's a real Safari-engine difference: fix it, don't skip it.

## Testing

`npm test` runs the smoke test over every built page. It then runs each
`projects/<name>/test/e2e.mjs`, whose default export is `async ({ browser, origin, engine })` and
throws on failure. That uses Chromium here and WebKit in CI. Assert **where** things draw, not
only what they show, and prove a new test can fail: break the code on purpose, watch it go red,
then restore it.

Measure sideways scroll as `scrollWidth - clientWidth`, never against `innerWidth`: under the
mobile emulation the tests use, Chromium widens `innerWidth` to the content, so an
`innerWidth` check can never fail. The smoke test used one until 2026-09-26.

## Studio (`projects/studio/`, at `/studio/`)

Studio shows the **live DOM** of any page on this site. Studio phase 1 is a viewer; later phases
turn it into a phone-first page and SVG editor.

- **How it works:**
  - it loads the page in a same-origin iframe; `?page=/hello/` makes a view linkable;
  - with **Select** on, a tap picks the element under the finger instead of activating it;
  - the **Tree** tab updates live;
  - the **Inspect** tab shows attributes, the box model and key styles;
  - the highlight is an overlay laid exactly over the iframe.
- **Stack:** React + Vite + TypeScript. It imports `ds/ds.css`.
- **The rule for studio code:** touch the framed page only through `FrameSession`
  (`src/frame.ts`). It owns the document, the MutationObserver, pick mode and the version
  channels (`structure` for the tree, `layout` for highlight and inspector). Editor phases add
  edits there as undoable commands.
- **Framed nodes are from another realm.** Never `instanceof Element`; check `nodeType`.
- **Not `viewport-fit=cover`**, deliberately. WebKit passes the whole page's safe-area insets into
  same-origin frames.
- **Known limits:**
  - an inline element that wraps is outlined as one box;
  - a transformed element gets no margin/padding shading;
  - changes inside shadow DOM don't update the tree.

## Draw (`projects/draw/`, at `/draw/`)

Mark's SVG-native design editor, built from SVG Lab. The approved plan (phases P0 to P8, the
support ledger, the security design) is in the vault's `_audit/2026-09-27 approved-plan draw.md`;
each phase opens with its own short plan. Until Release 1 it carries
`<meta name="launcher" content="unlisted">`: deployed and tested, not on the launcher.

- **One render sink.** Document content reaches the page only through
  `src/canvas/safe-sink.ts`. `tools/check-sinks.mjs` fails the build on:
  - `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
    `dangerouslySetInnerHTML`, `srcdoc`, `eval` and `new Function` anywhere;
  - DOM writes outside the sink and the overlay;
  - storage outside `src/platform/`, and network outside `platform/`, `github/` and `export/`;
  - a password field outside `src/github/TokenForm.tsx`;
  - `allow-same-origin` anywhere (the script preview stays an opaque origin).
- **The built page's first `<head>` element is a meta CSP** (`script-src 'self'`,
  `connect-src 'self' https://api.github.com`, …): a backstop, not the defense.
- **`engine/` is DOM-free and dependency-free**, in erasable TypeScript with `.ts` import
  extensions, so `node --test` runs it as-is and any project may import it.
- **The support ledger** (`engine/ledger/ledger.json`) says what Draw edits, keeps, previews or
  drops, and which SVG Lab capability lands in which phase. `tools/ledger-check.mjs` gates the
  build. Rows are never deleted.
- **The library** (from P2, `projects/draw/public/library/`, served at `/draw/library/`) is public.
  - Every `.svg` in it, and every `.svg` anywhere on the site, must pass
    `scripts/lib/svg-profile.mjs` (`scripts/check-library.mjs`, source and `--site` modes, both
    in CI). A script-bearing design keeps its source only in its escaped `.draw.json` sidecar.
  - `index.json` is generated at build, never committed.
  - The GitHub token comes from Mark at run time (Keychain-filled, memory only), never from a file.
- **Build chain:** `check-sinks → ledger-check → tsc → node --test (engine + unit) → vite build →
  library-index`. It runs inside `npm run build`, so CI gates all of it.

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

## Design system (every project uses it)

`ds/ds.css` holds the tokens and components. Browse them on the phone at `/ds/`.

- **Form fields have a 16px text floor** (`input, select, textarea`). iOS zooms the whole page
  into any focused field under 16px, and at 75% every rem-sized field would be.
- **Use it.**
  - Static project: `<link rel="stylesheet" href="/ds/ds.css">`.
  - Vite project: `import '../../ds/ds.css'` in the entry file, so it gets bundled and works
    offline.
- **Size everything in rem, never px.** The UI scales from one knob: `--ui-scale` sets the root
  font size.
  - Mark chose **75%** (2026-09-25), so 1rem = 12px.
  - A raw px value wouldn't scale with everything around it.
  - `npm run check` and CI fail on any px except whole 0–3px values (hairlines, focus rings) or a
    line marked `px-ok` with its reason. Decimals such as 1.5px fail: use rem, or a whole px.
  - `px-ok` exempts the whole line, so put a physical value (a 16px field floor, say) in a rule
    of its own.
  - In SVG CSS, write stroke widths unitless: `stroke-width:1.5` is the same user units as 1.5px.
  - Only `.css` files, `<style>` blocks and `style=""` attributes are checked. Canvas and SVG
    coordinates in JS are fine.
- **Use the tokens, not new numbers.** Token values are written at a 16px base, so 1.0625rem is
  "17 at 100%".
  - **Text:** `--text-sm` (15), `--text-md` (17, body), `--text-lg` (22), `--text-xl` (28),
    `--text-display` (56).
  - **Font:** `--font-ui`, `--font-mono`.
  - **Space:** `--space-1…8` (4, 8, 12, 16, 20, 24, 32, 48).
  - **Shape:** `--radius-sm`, `--radius`, `--control-h` (52), `--control-h-sm` (44),
    `--measure`.
  - **Color:** `--bg`, `--surface`, `--text`, `--text-muted`, `--line`, `--accent`,
    `--on-accent`, in light and dark automatically.
- **Tap floor: `--tap-min` is 44px on purpose and never scales.** Size any tappable thing as
  `min-height: max(var(--tap-min), <rem size>)`. The ds controls already do this.
- **Components**, prefixed `ds-` so they don't collide with project classes:
  - `ds-app` (100svh shell with safe areas) and `ds-page` (content column);
  - `ds-title`, `ds-heading`, `ds-sub`, `ds-muted`, `ds-small`, `ds-num`, `ds-display`, `ds-mono`;
  - `ds-cards` / `ds-card` (`ds-card-title`, `ds-card-text`) for tappable tiles;
  - `ds-list` / `ds-row` for key-value rows (`<dl>` with `<div class="ds-row"><dt><dd>`);
  - `ds-btn` and `ds-btn--primary`;
  - `ds-seg`, a segmented control where the chosen button has `aria-pressed="true"`;
  - `ds-bar`, the sticky bottom action bar in the thumb zone.
- **Changing `ds.css` changes every project at once.** The smoke test covers every page on each
  deploy. Add a component only when a second project needs it.
- **Overriding the scale:** set `--ui-scale` on `<html>`. `projects/hello/` has a live preview
  switch.

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
  - tap targets never under 44pt: use ds controls, or `max(var(--tap-min), …)`;
  - primary actions in the bottom thumb zone, clear of the home indicator;
  - `touch-action: manipulation` on buttons.
- **Text and motion:**
  - body text is `--text-md`, and nothing smaller than `--text-sm`;
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
