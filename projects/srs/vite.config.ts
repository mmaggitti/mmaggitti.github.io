import { defineConfig, type Plugin } from 'vite';

// Node's process, declared here rather than adding @types/node as a dependency for one line.
declare const process: { env: Record<string, string | undefined> };

// Content Security Policy for the BUILT page (the dev server's HMR needs inline scripts).
// 'wasm-unsafe-eval' lets the page and its workers compile WebAssembly; workers are same-origin.
// GitHub Pages can't send headers, so a meta tag is the only option.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'core-and-seams-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/<head>/i, `<head>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`),
    },
  };
}

// BASE_PATH is set by the site's scripts/build-site.mjs (/srs/). Relative URLs everywhere else,
// so the same build works under any base path and inside Tauri (Core & Seams SEAMS.md, hosting).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [csp()],
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
