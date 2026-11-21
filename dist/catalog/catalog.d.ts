/** Fetches the live free-pi model catalog. */
import type { Deps } from "../deps.js";
import type { Catalog } from "../types.js";
/** Refreshes the catalog without blocking callers that already have data. */
export declare function refreshCatalog(deps: Deps): Promise<Catalog | undefined>;
export declare function fetchCatalog(deps: Deps): Promise<Catalog | undefined>;
