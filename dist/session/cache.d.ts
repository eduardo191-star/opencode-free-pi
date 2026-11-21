/**
 * Prompt-cache miss notices, mirroring pi's `cache-stats` detector.
 *
 * free-pi reports no per-token cost, so only the token threshold applies. The
 * notices are opt-in because OpenCode has no toast surface for them.
 */
import type { Deps } from "../deps.js";
import type { TokenUsageLike } from "../types.js";
/**
 * Records one step's usage and logs a miss when the prompt was re-billed.
 * `session.step.ended` carries per-step tokens; `session.usage.updated` is a
 * cumulative total and must not be fed here.
 */
export declare function observeStepUsage(deps: Deps, sessionID: string | undefined, tokens: TokenUsageLike | undefined): void;
export declare function forgetCacheMiss(deps: Deps, sessionID: string): void;
