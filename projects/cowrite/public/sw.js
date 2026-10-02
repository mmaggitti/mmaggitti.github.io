// Co-write service worker. Scoped to this app's folder (every project shares the origin), and
// skipped inside Tauri. build.mjs replaces the build id, so each deploy gets a fresh cache.
//   pages:   network first, so an installed app picks up new builds when online (an installed web
//            app otherwise pins its old build); the cached copy when offline
//   assets:  cache first; Vite's file names carry a content hash, so a cached asset never goes stale
const CACHE = 'cowrite:__BUILD_ID__';
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('cowrite:') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) await cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(req)) ?? (await cache.match(SCOPE)) ?? Response.error();
        }
      }
      const hit = await cache.match(req);
      if (hit) return hit;
      const fresh = await fetch(req);
      if (fresh.ok) await cache.put(req, fresh.clone());
      return fresh;
    })(),
  );
});
