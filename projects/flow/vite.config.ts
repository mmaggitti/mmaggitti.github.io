import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH is set by scripts/build-site.mjs (/flow/); without it every asset 404s under /flow/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
});
