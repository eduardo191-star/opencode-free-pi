/**
 * Tracks the `x-session-id` each OpenCode session sends to free-pi.
 *
 * free-pi admits one in-flight request per wire session id. The server can
 * leave a per-session lock behind after a crashed or aborted stream, and a new
 * request on the same id then fails with `429 concurrent` forever: resets do
 * not clear it. Rotating the wire id is the recovery, so the plugin keeps the
 * mapping until the OpenCode session is gone.
 */
import type { Deps } from "../deps.js";
export declare function wireSessionID(deps: Deps, sessionID: string): string;
/**
 * Records that a turn ended without a clean stream (aborted, interrupted or
 * failed mid-flight). The server can keep the per-session request slot locked
 * in that case, so the next turn must not reuse the id: it would get a
 * `429 concurrent` and OpenCode would show a retry. The next `model.request`
 * rotates to a fresh id instead and the turn continues normally.
 */
export declare function markWireSessionDirty(deps: Deps, sessionID: string): void;
export declare function takeWireSessionDirty(deps: Deps, sessionID: string): boolean;
/** Points the OpenCode session at a fresh wire id and returns it. */
export declare function rotateWireSessionID(deps: Deps, sessionID: string): string;
export declare function forgetWireSessionID(deps: Deps, sessionID: string): void;
