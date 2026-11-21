/** Fetches the models.dev capability registry. */
import type { Deps } from "../deps.js";
import type { ModelRegistry } from "../types.js";
/**
 * Refreshes the registry without blocking callers that already have data.
 * Concurrent calls share one request.
 */
export declare function refreshModelsRegistry(deps: Deps): Promise<ModelRegistry | undefined>;
export declare function fetchModelsRegistry(deps: Deps): Promise<ModelRegistry | undefined>;
