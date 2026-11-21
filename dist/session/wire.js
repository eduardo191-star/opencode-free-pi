/**
 * Tracks the `x-session-id` each OpenCode session sends to free-pi.
 *
 * free-pi admits one in-flight request per wire session id. The server can
 * leave a per-session lock behind after a crashed or aborted stream, and a new
 * request on the same id then fails with `429 concurrent` forever: resets do
 * not clear it. Rotating the wire id is the recovery, so the plugin keeps the
 * mapping until the OpenCode session is gone.
 */
import { trimSet } from "../utils/async.js";
const DIRTY_LIMIT = 256;
export function wireSessionID(deps, sessionID) {
    return deps.state.wireSessions.get(sessionID) ?? sessionID;
}
/**
 * Records that a turn ended without a clean stream (aborted, interrupted or
 * failed mid-flight). The server can keep the per-session request slot locked
 * in that case, so the next turn must not reuse the id: it would get a
 * `429 concurrent` and OpenCode would show a retry. The next `model.request`
 * rotates to a fresh id instead and the turn continues normally.
 */
export function markWireSessionDirty(deps, sessionID) {
    if (!sessionID)
        return;
    deps.state.dirtySessions.add(sessionID);
    trimSet(deps.state.dirtySessions, DIRTY_LIMIT);
}
export function takeWireSessionDirty(deps, sessionID) {
    return deps.state.dirtySessions.delete(sessionID);
}
/** Points the OpenCode session at a fresh wire id and returns it. */
export function rotateWireSessionID(deps, sessionID) {
    const suffix = Math.random().toString(36).slice(2, 10);
    const next = `${sessionID}-r${suffix}`;
    deps.state.wireSessions.set(sessionID, next);
    return next;
}
export function forgetWireSessionID(deps, sessionID) {
    deps.state.wireSessions.delete(sessionID);
    deps.state.dirtySessions.delete(sessionID);
}
