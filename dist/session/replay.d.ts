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
export type OverflowReplay = {
    /** Tokens of the rejected request, when its body was available. */
    readonly tokens?: number;
    /** Upstream model the rejected request asked for. */
    readonly model?: string;
    /** Whether the rejected request carried an inline image or file. */
    readonly hasMedia?: boolean;
    /** Whether the rejected request plainly fits the model window. */
    readonly spurious?: boolean;
    /** A good response from a fresh wire session, when the retry succeeded. */
    readonly response?: Response;
};
/**
 * Retries an overflow rejection whose request plainly fits the model window.
 *
 * free-pi reports `context_ceiling`/`context_too_long` from the upstream
 * model, and a failing gateway can report them for a small prompt. Compacting
 * cannot fix that: the summary is accepted, the next turn is rejected the same
 * way, and the runner compacts again. A fresh wire session is the cheapest
 * recovery, so a small request is replayed on one before the overflow is
 * handed to the runner.
 */
export declare function replaySpuriousOverflow(deps: Deps, event: any): Promise<OverflowReplay>;
