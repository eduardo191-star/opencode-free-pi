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
/** Points the OpenCode session at a fresh wire id and returns it. */
export declare function rotateWireSessionID(deps: Deps, sessionID: string): string;
export declare function forgetWireSessionID(deps: Deps, sessionID: string): void;
