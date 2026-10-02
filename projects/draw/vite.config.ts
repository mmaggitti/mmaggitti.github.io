import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The app's Content Security Policy, as the first element in <head> of the BUILT page (the dev
// server with HMR needs inline scripts, so it is build-only). It is a backstop behind the render
// sink: inline handlers and javascript: URLs that slip past it are blocked, and the app talks to no
// host but its own. Violations log console errors, which the smoke test fails on. Pages can't send
// CSP headers, so a meta tag is the only option.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'draw-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/<head>/i, `<head>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`),
    },
  };
}

// BASE_PATH is set by scripts/build-site.mjs (/draw/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), csp()],
});
