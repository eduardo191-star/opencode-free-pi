/** Small async helpers. */
export declare function sleep(ms: number): Promise<void>;
/** Resolves with `fallback` if `promise` does not settle within `ms`. */
export declare function settle<T>(promise: Promise<T>, fallback: T, ms?: number): Promise<T>;
/** Adds an LRU-ish cap to a `Map` keyed by insertion order. */
export declare function trimMap<K, V>(map: Map<K, V>, limit: number): void;
/** Adds an LRU-ish cap to a `Set` ordered by insertion. */
export declare function trimSet<T>(set: Set<T>, limit: number): void;
