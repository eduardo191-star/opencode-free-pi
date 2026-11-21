/**
 * Tracks sessions served by free-pi and closes their server-side slot once the
 * session goes quiet.
 *
 * free-pi limits an account to four concurrent sessions, so every execution has
 * to release its slot. Auxiliary requests such as background compaction can
 * start after the last step, which is why the close is delayed and re-armed by
 * later activity instead of running inline with the execution event.
 */
import type { Deps } from "../deps.js";
export declare function rememberFreePiSession(deps: Deps, sessionID: string): void;
/** Records free-pi activity so a pending close waits for the request to settle. */
export declare function touchSessionActivity(deps: Deps, sessionID: string): void;
export declare function beginExecution(deps: Deps, sessionID: string): void;
export declare function endExecution(deps: Deps, sessionID: string): void;
export declare function cancelFinalizeTimer(deps: Deps, sessionID: string): void;
export declare function cancelAllFinalizeTimers(deps: Deps): void;
/** Closes the session slot after `SESSION_FINALIZE_DELAY_MS` without activity. */
export declare function scheduleFreePiFinalize(deps: Deps, sessionID: string): void;
export declare function finalizeFreePiSession(deps: Deps, sessionID: string): Promise<void>;
export declare function forgetFreePiSession(deps: Deps, sessionID: string): void;
