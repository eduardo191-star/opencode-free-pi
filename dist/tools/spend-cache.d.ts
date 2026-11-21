/**
 * Spend-once cache for the free-pi tools that consume allowance.
 *
 * `web_search`, `docs_lookup` and `look_at_image` bill the user every time they
 * run. Models often ask the same question twice in a turn (or a subagent and
 * its lead both ask it), so identical inputs reuse the first answer instead of
 * spending credits again. Failures are never cached: the next attempt must
 * reach the server and see the real error. Concurrent identical calls share one
 * in-flight request, so a parallel tool call cannot double-charge either.
 */
import type { Deps } from "../deps.js";
import type { ToolOutput } from "./api.js";
/** Long enough to cover a turn and its follow-ups, short enough to stay fresh. */
export declare const SPEND_CACHE_TTL_MS: number;
export declare function spendOnce(deps: Deps, key: string, run: () => Promise<ToolOutput>): Promise<ToolOutput>;
