/** Small async helpers. */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves with `fallback` if `promise` does not settle within `ms`. */
export function settle<T>(
  promise: Promise<T>,
  fallback: T,
  ms = 6_000,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Adds an LRU-ish cap to a `Map` keyed by insertion order. */
export function trimMap<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

/** Adds an LRU-ish cap to a `Set` ordered by insertion. */
export function trimSet<T>(set: Set<T>, limit: number): void {
  while (set.size > limit) {
    const oldest = set.values().next().value;
    if (oldest === undefined) return;
    set.delete(oldest);
  }
}
