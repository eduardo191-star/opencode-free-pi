/** Fetches the models.dev capability registry. */
import { REGISTRY_ATTEMPTS, REGISTRY_DISK_TTL_MS, REGISTRY_RETRY_MS, REGISTRY_TIMEOUT_MS, REGISTRY_TTL_MS, } from "../constants.js";
import { sleep } from "../utils/async.js";
import { readCache, writeCache } from "../utils/cache.js";
import { modelsRegistryUrl } from "../utils/urls.js";
const CACHE_FILE = "models-dev.json";
function isRegistry(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function reasonText(error) {
    if (error instanceof Error) {
        return error.name === "TimeoutError" ? "request timed out" : error.message;
    }
    return "request failed";
}
async function requestRegistry() {
    const base = modelsRegistryUrl();
    const url = base.endsWith(".json") ? base : `${base}/api.json`;
    let lastError;
    for (let attempt = 1; attempt <= REGISTRY_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: { accept: "application/json" },
                signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            return (await response.json());
        }
        catch (error) {
            lastError = error;
            if (attempt < REGISTRY_ATTEMPTS)
                await sleep(500 * attempt);
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error("models.dev request failed");
}
/**
 * Refreshes the registry without blocking callers that already have data.
 * Concurrent calls share one request.
 */
export function refreshModelsRegistry(deps) {
    const state = deps.state;
    if (state.registryPromise)
        return state.registryPromise;
    const pending = (async () => {
        state.registryAttemptAt = Date.now();
        try {
            const registry = await requestRegistry();
            if (!isRegistry(registry)) {
                throw new Error("models.dev returned an unexpected payload");
            }
            state.cachedRegistry = registry;
            state.cachedRegistryAt = Date.now();
            void writeCache(CACHE_FILE, registry);
            return registry;
        }
        catch (error) {
            const cached = state.cachedRegistry;
            deps.log.warn(cached
                ? "models.dev is unreachable; using cached model metadata"
                : "models.dev is unreachable; model limits fall back to defaults", { reason: reasonText(error) });
            return cached;
        }
    })();
    state.registryPromise = pending;
    void pending.finally(() => {
        if (state.registryPromise === pending)
            state.registryPromise = undefined;
    });
    return pending;
}
export async function fetchModelsRegistry(deps) {
    const state = deps.state;
    if (state.cachedRegistry &&
        Date.now() - state.cachedRegistryAt < REGISTRY_TTL_MS) {
        return state.cachedRegistry;
    }
    if (!state.cachedRegistry) {
        const disk = await readCache(CACHE_FILE, REGISTRY_DISK_TTL_MS);
        if (isRegistry(disk)) {
            state.cachedRegistry = disk;
            state.cachedRegistryAt = Date.now();
            // Serve the cached copy immediately and refresh it in the background.
            void refreshModelsRegistry(deps);
            return disk;
        }
    }
    if (state.registryAttemptAt &&
        Date.now() - state.registryAttemptAt < REGISTRY_RETRY_MS) {
        return state.cachedRegistry;
    }
    return refreshModelsRegistry(deps);
}
