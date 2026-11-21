/** Account quota fetching shared by error handling and usage tracking. */
import type { Deps } from "../deps.js";
import type { QuotaSnapshot, TokenCheckState } from "../types.js";
export declare function rememberTokenCheck(deps: Deps, token: string, state: TokenCheckState): void;
export declare function fetchQuota(deps: Deps, opts?: {
    force?: boolean;
    stats?: boolean;
}): Promise<QuotaSnapshot>;
