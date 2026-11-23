/** Fetches the live free-pi model catalog. */
import { resolveToken } from "../auth/token.js";
import { CATALOG_ATTEMPTS, CATALOG_RETRY_MS, CATALOG_TIMEOUT_MS, CATALOG_TTL_MS, } from "../constants.js";
import { sleep } from "../utils/async.js";
import { resolveBaseUrl } from "../utils/urls.js";
function isCatalog(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function reasonText(error) {
    if (error instanceof Error) {
        return error.name === "TimeoutError" ? "request timed out" : error.message;
    }
    return "request failed";
}
function applyCatalog(deps, catalog) {
    const state = deps.state;
    if (typeof catalog.latest === "string" && catalog.latest.length > 0) {
        state.latestClientVersion = catalog.latest;
    }
    if (typeof catalog.notice === "string" &&
        catalog.notice &&
        catalog.notice !== state.lastCatalogNotice) {
        state.lastCatalogNotice = catalog.notice;
        deps.log.info("free-pi catalog notice", { notice: catalog.notice });
    }
    state.cachedCatalog = catalog;
    state.cachedCatalogAt = Date.now();
    return catalog;
}
/** Refreshes the catalog without blocking callers that already have data. */
export function refreshCatalog(deps) {
    const state = deps.state;
    if (state.catalogPromise)
        return state.catalogPromise;
    const pending = (async () => {
        let lastError;
        for (let attempt = 1; attempt <= CATALOG_ATTEMPTS; attempt += 1) {
            try {
                const token = await resolveToken(deps).catch(() => undefined);
                const headers = {
                    accept: "application/json",
                };
                if (token)
                    headers.authorization = `Bearer ${token}`;
                const response = await fetch(`${resolveBaseUrl()}/client-version`, {
                    headers,
                    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
                });
                if (!response.ok)
                    throw new Error(`HTTP ${response.status}`);
                const catalog = (await response.json());
                if (!isCatalog(catalog)) {
                    throw new Error("free-pi returned an unexpected catalog payload");
                }
                applyCatalog(deps, catalog);
                return catalog;
            }
            catch (error) {
                lastError = error;
                // A timeout or a dropped connection is often transient. Retrying here
                // avoids registering a provider with zero models for this location,
                // which would hide every free-pi model from the picker until OpenCode
                // restarts.
                if (attempt < CATALOG_ATTEMPTS) {
                    deps.log.info("free-pi catalog request failed; retrying", {
                        attempt,
                        reason: reasonText(error),
                    });
                    await sleep(CATALOG_RETRY_MS * attempt);
                }
            }
        }
        const cached = state.cachedCatalog;
        deps.log.warn(cached
            ? "free-pi catalog is unreachable; using the cached model list"
            : "free-pi catalog is unreachable; no free-pi models were registered", { reason: reasonText(lastError) });
        return cached;
    })();
    state.catalogPromise = pending;
    void pending.finally(() => {
        if (state.catalogPromise === pending)
            state.catalogPromise = undefined;
    });
    return pending;
}
export async function fetchCatalog(deps) {
    const state = deps.state;
    if (state.cachedCatalog && Date.now() - state.cachedCatalogAt < CATALOG_TTL_MS) {
        return state.cachedCatalog;
    }
    return refreshCatalog(deps);
}
