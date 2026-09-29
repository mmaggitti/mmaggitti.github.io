// A media query as React state (the iPad and landscape dock, reduced motion).

import { useSyncExternalStore } from 'react';

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = matchMedia(query);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => matchMedia(query).matches,
  );
}

/**
 * Wide screens (an iPad or a desktop in landscape) and short landscape phones: the code docks
 * beside the canvas instead of under it. The same query is in app.css; keep the two in step.
 */
export const DOCK = '(min-width: 46em) and (min-aspect-ratio: 5/4)';
