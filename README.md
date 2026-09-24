# mmaggitti.github.io

Phone-first mini projects, one folder each, served at **https://mmaggitti.github.io/**.

- `projects/<name>/` → `https://mmaggitti.github.io/<name>/`
- The launcher at `/` is generated from each project's `<title>` and description.
- Every push to `main` runs a pre-publish guard, builds every project, runs a phone-size smoke test
  in WebKit, and deploys to GitHub Pages.

```bash
npm install
npm run verify     # guard + build + smoke test
```

Everything in this repo is public. See [CLAUDE.md](CLAUDE.md) for the rules the build sessions
follow.
