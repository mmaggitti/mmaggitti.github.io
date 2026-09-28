// A framework-free store: the app's state lives here, not in React (ADR-004). Panels subscribe;
// direct manipulation (drags, orbits, strokes) talks to the core without rendering React at all.

export interface Store<S> {
  get(): S;
  set(patch: Partial<S>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
