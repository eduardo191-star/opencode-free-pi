/** Small async helpers. */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Resolves with `fallback` if `promise` does not settle within `ms`. */
export function settle(promise, fallback, ms = 6_000) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
}
/** Adds an LRU-ish cap to a `Map` keyed by insertion order. */
export function trimMap(map, limit) {
    while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === undefined)
            return;
        map.delete(oldest);
    }
}
/** Adds an LRU-ish cap to a `Set` ordered by insertion. */
export function trimSet(set, limit) {
    while (set.size > limit) {
        const oldest = set.values().next().value;
        if (oldest === undefined)
            return;
        set.delete(oldest);
    }
}
