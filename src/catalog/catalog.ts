/** Fetches the live free-pi model catalog. */

import {
  CATALOG_DISK_TTL_MS,
  CATALOG_TIMEOUT_MS,
  CATALOG_TTL_MS,
} from "../constants.js";
import type { Deps } from "../deps.js";
import type { Catalog } from "../types.js";
import { readCache, writeCache } from "../utils/cache.js";
import { resolveBaseUrl } from "../utils/urls.js";

const CACHE_FILE = "catalog.json";

function isCatalog(value: unknown): value is Catalog {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reasonText(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "request timed out" : error.message;
  }
  return "request failed";
}

function applyCatalog(deps: Deps, catalog: Catalog): Catalog {
  const state = deps.state;
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

/** Refreshes the catalog without blocking callers that already have data. */
export function refreshCatalog(deps: Deps): Promise<Catalog | undefined> {
  const state = deps.state;
  if (state.catalogPromise) return state.catalogPromise;
  const pending = (async () => {
    try {
      const response = await fetch(`${resolveBaseUrl()}/client-version`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const catalog = (await response.json()) as Catalog;
      if (!isCatalog(catalog)) {
        throw new Error("free-pi returned an unexpected catalog payload");
      }
      applyCatalog(deps, catalog);
      void writeCache(CACHE_FILE, catalog);
      return catalog;
    } catch (error) {
      const cached = state.cachedCatalog;
      deps.log.warn(
        cached
          ? "free-pi catalog is unreachable; using the cached model list"
          : "free-pi catalog is unreachable; no free-pi models were registered",
        { reason: reasonText(error) },
      );
      return cached;
    }
  })();
  state.catalogPromise = pending;
  void pending.finally(() => {
    if (state.catalogPromise === pending) state.catalogPromise = undefined;
  });
  return pending;
}

export async function fetchCatalog(deps: Deps): Promise<Catalog | undefined> {
  const state = deps.state;
  if (state.cachedCatalog && Date.now() - state.cachedCatalogAt < CATALOG_TTL_MS) {
    return state.cachedCatalog;
  }

  if (!state.cachedCatalog) {
    const disk = await readCache<Catalog>(CACHE_FILE, CATALOG_DISK_TTL_MS);
    if (isCatalog(disk)) {
      applyCatalog(deps, disk);
      // Serve the cached copy immediately and refresh it in the background.
      void refreshCatalog(deps);
      return disk;
    }
  }

  return refreshCatalog(deps);
}
