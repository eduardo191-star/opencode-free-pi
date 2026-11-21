/**
 * Tracks the `x-session-id` each OpenCode session sends to free-pi.
 *
 * free-pi admits one in-flight request per wire session id. The server can
 * leave a per-session lock behind after a crashed or aborted stream, and a new
 * request on the same id then fails with `429 concurrent` forever: resets do
 * not clear it. Rotating the wire id is the recovery, so the plugin keeps the
 * mapping until the OpenCode session is gone.
 */
export function wireSessionID(deps, sessionID) {
    return deps.state.wireSessions.get(sessionID) ?? sessionID;
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
}
