// What the page knows about where it runs. The same build runs as the PWA and inside Tauri.

/** True inside a Tauri shell (desktop or iOS). */
export const inTauri = (): boolean => '__TAURI_INTERNALS__' in globalThis;

/** Density the CSS is applying: comfortable wherever a coarse pointer exists (ADR-007). */
export const density = (): 'comfortable' | 'compact' => {
  const forced = document.documentElement.dataset.density;
  if (forced === 'comfortable') return 'comfortable';
  return matchMedia('(any-pointer: coarse)').matches ? 'comfortable' : 'compact';
};

/**
 * Register the app's service worker, scoped to its own folder (never "/": every project shares the
 * origin). Skipped inside Tauri, where the app's files are local already.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (inTauri() || !('serviceWorker' in navigator) || import.meta.env.DEV) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    return null;
  }
}
