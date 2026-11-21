/** Tracks the last request's model and token usage and refreshes quota. */
import type { Deps } from "../deps.js";
import type { TokenUsageLike } from "../types.js";
export declare function rememberTrackedModel(deps: Deps, sessionID: string, providerID: string, modelID: string): void;
export declare function recordUsage(deps: Deps, sessionID: string, cost: number, tokens: TokenUsageLike | undefined): void;
