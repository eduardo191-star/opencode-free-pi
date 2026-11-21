/**
 * Transparently replays a free-pi request that hit the per-session
 * `429 concurrent` limit.
 *
 * OpenCode builds the provider request once and reuses it for every retry of a
 * step (`SessionRunner.runStep` calls `request.primary` outside the attempt
 * loop). Rotating `x-session-id` in the retry hook therefore cannot help the
 * failed attempt: the retried request still carries the old id. The server can
 * also leave a session slot locked after an aborted stream, which resets do not
 * clear.
 *
 * Replaying from `http.response` instead sends the same body with a fresh wire
 * session id and returns the good response to OpenCode, so the turn continues
 * without a visible "Retrying…" or a failed step.
 */
import type { Deps } from "../deps.js";
/** Keeps the body around so a 429 can be replayed after fetch consumed it. */
export declare function rememberReplayBody(deps: Deps, event: any): Promise<void>;
/**
 * Returns a replacement response when a concurrent 429 was recovered, or
 * `undefined` to leave the original response untouched.
 */
export declare function replayConcurrentResponse(deps: Deps, event: any): Promise<Response | undefined>;
