// The catalogue's font files (P1-M4), by file name (<slug>-latin-<weight>-<style>.woff2): every latin
// .woff2 of Draw's @fontsource packages, as the URLs Vite emits into dist/assets. Nothing fetches one
// until a drawing uses its face or the Font sheet shows its family (src/platform/fonts.ts).
// Vite-only (import.meta.glob), so it is loaded by fonts.ts's dynamic import() alone: node's tests
// never import it, and the URLs stay out of the first chunk. font-catalogue.ts is the same faces as
// plain data; its test checks them against the packages' files.

const found = import.meta.glob<string>('../../node_modules/@fontsource/*/files/*-latin-[0-9]*-{normal,italic}.woff2', { query: '?url', import: 'default', eager: true });

export const FONT_FILES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(found).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]));
