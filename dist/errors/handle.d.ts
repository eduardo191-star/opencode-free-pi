/** Central handling for free-pi failures reported by the provider or session. */
import type { Deps } from "../deps.js";
export declare function handleFreePiError(deps: Deps, error: any, opts?: {
    allowRaw?: boolean;
}): Promise<void>;
