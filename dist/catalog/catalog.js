/** Fetches the live free-pi model catalog. */
import { CATALOG_TTL_MS } from "../constants.js";
import { resolveBaseUrl } from "../utils/urls.js";
export async function fetchCatalog(deps) {
    const state = deps.state;
    if (state.cachedCatalog && Date.now() - state.cachedCatalogAt < CATALOG_TTL_MS) {
        return state.cachedCatalog;
    }
    if (state.catalogPromise)
        return state.catalogPromise;
    const pending = (async () => {
        try {
            const response = await fetch(`${resolveBaseUrl()}/client-version`, {
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok)
                return state.cachedCatalog;
            const catalog = (await response.json());
            if (typeof catalog.latest === "string" && catalog.latest.length > 0) {
                state.latestClientVersion = catalog.latest;
            }
            const arm = catalog.cost_experiment?.arm;
            state.costExperimentArm =
                typeof arm === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(arm)
                    ? arm
                    : undefined;
            state.cachedCatalog = catalog;
            state.cachedCatalogAt = Date.now();
            return catalog;
        }
        catch {
            return state.cachedCatalog;
        }
    })();
    state.catalogPromise = pending;
    try {
        return await pending;
    }
    finally {
        if (state.catalogPromise === pending)
            state.catalogPromise = undefined;
    }
}
