/** Fetches the models.dev capability registry. */

import { REGISTRY_TTL_MS } from "../constants.js";
import type { Deps } from "../deps.js";
import type { ModelRegistry } from "../types.js";
import { modelsRegistryUrl } from "../utils/urls.js";

export async function fetchModelsRegistry(
  deps: Deps,
): Promise<ModelRegistry | undefined> {
  const state = deps.state;
  if (state.cachedRegistry && Date.now() - state.cachedRegistryAt < REGISTRY_TTL_MS) {
    return state.cachedRegistry;
  }
  if (
    !state.cachedRegistry &&
    state.registryAttemptAt &&
    Date.now() - state.registryAttemptAt < REGISTRY_TTL_MS
  ) {
    return undefined;
  }
  if (state.registryPromise) return state.registryPromise;
  const pending = (async () => {
    state.registryAttemptAt = Date.now();
    try {
      const base = modelsRegistryUrl();
      const url = base.endsWith(".json") ? base : `${base}/api.json`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return state.cachedRegistry;
      const registry = (await response.json()) as ModelRegistry;
      if (
        !registry ||
        typeof registry !== "object" ||
        Array.isArray(registry)
      ) {
        return state.cachedRegistry;
      }
      state.cachedRegistry = registry;
      state.cachedRegistryAt = Date.now();
      return registry;
    } catch {
      return state.cachedRegistry;
    }
  })();
  state.registryPromise = pending;
  try {
    return await pending;
  } finally {
    if (state.registryPromise === pending) state.registryPromise = undefined;
  }
}
