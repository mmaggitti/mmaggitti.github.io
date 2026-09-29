import { defineConfig } from 'vite';

// Content Security Policy for the BUILT page (the dev server's HMR needs inline scripts).
// 'wasm-unsafe-eval' lets the kernel's worker compile WebAssembly; the worker is same-origin.
// GitHub Pages can't send headers, so a meta tag is the only option.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function csp() {
  return {
    name: 'cad-kernel-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/<head>/i, `<head>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`),
    },
  };
}

// BASE_PATH is set by the site's scripts/build-site.mjs (/cad-kernel/); without it every asset
// 404s under /cad-kernel/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [csp()],
  worker: { format: 'es' },
  // Three.js alone is about 640 kB minified (160 kB gzipped); that is expected, not a warning.
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 800 },
});
