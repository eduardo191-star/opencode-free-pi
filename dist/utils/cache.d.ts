/** Best-effort JSON cache on disk for data fetched over the network. */
export declare function cacheDir(): string;
export declare function cachePath(name: string): string;
/** Reads a cached value when it is younger than `ttlMs`. Never throws. */
export declare function readCache<T>(name: string, ttlMs: number): Promise<T | undefined>;
/** Writes a value atomically. Never throws. */
export declare function writeCache<T>(name: string, value: T): Promise<void>;
