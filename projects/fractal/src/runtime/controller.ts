// What an app's UI may know about its own presentation. Updated only when motion settles (or when a
// discrete fact like visibility changes), so apps never re-render during an animation.
// (The idea of Trellis's runtime/view.ts ViewController.)

import type { Tier } from '../core/lod.ts';

export interface AppView {
  visible: boolean;
  tier: Tier;
  /** The size content is laid out at, in CSS px. */
  size: { w: number; h: number };
  /** How much it is drawn scaled down (1 at full size). */
  scale: number;
  /** True when it takes input: visible, full size, not mid-gesture. */
  interactive: boolean;
}

export class AppController {
  private state: AppView = { visible: false, tier: 'live', size: { w: 0, h: 0 }, scale: 1, interactive: false };
  private listeners = new Set<() => void>();
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  get = (): AppView => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  update(patch: Partial<AppView>) {
    const next = { ...this.state, ...patch };
    const s = this.state;
    if (
      next.visible === s.visible &&
      next.tier === s.tier &&
      next.scale === s.scale &&
      next.interactive === s.interactive &&
      next.size.w === s.size.w &&
      next.size.h === s.size.h
    )
      return;
    this.state = next;
    for (const fn of this.listeners) fn();
  }
}

/** A value with subscribers, for useSyncExternalStore. */
export class Store<T> {
  private value: T;
  private listeners = new Set<() => void>();
  constructor(value: T) {
    this.value = value;
  }
  get = (): T => this.value;
  set(value: T) {
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const fn of this.listeners) fn();
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}
