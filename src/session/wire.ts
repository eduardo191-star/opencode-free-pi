/**
 * Tracks the `x-session-id` each OpenCode session sends to free-pi.
 *
 * free-pi admits one in-flight request per wire session id. The server can
 * leave a per-session lock behind after a crashed or aborted stream, and a new
 * request on the same id then fails with `429 concurrent` forever: resets do
 * not clear it. Rotating the wire id is the recovery, so the plugin keeps the
 * mapping until the OpenCode session is gone.
 *
 * The mapping is also stored in plugin storage, which is how an OpenCode
 * session reopened after a restart reconnects to the same provider session
 * instead of starting a new one. If that old id turns out to be locked, the
 * existing replay path rotates it on the first `429 concurrent`.
 */

import type { Deps } from "../deps.js";
import { trimSet } from "../utils/async.js";

const DIRTY_LIMIT = 256;
const HYDRATED_LIMIT = 1024;
const STORAGE_PREFIX = "wire-session/";

function storageKey(sessionID: string): string {
  return `${STORAGE_PREFIX}${sessionID}`;
}

export function wireSessionID(deps: Deps, sessionID: string): string {
  return deps.state.wireSessions.get(sessionID) ?? sessionID;
}

/**
 * Loads the provider session id saved for this OpenCode session, if any. The
 * first request of a process calls this before deciding whether to rotate, so a
 * resumed session can keep using its provider-side session.
 */
export async function hydrateWireSessionID(
  deps: Deps,
  sessionID: string,
): Promise<void> {
  if (!sessionID) return;
  if (deps.state.wireSessions.has(sessionID)) return;
  if (deps.state.wireHydrated.has(sessionID)) return;
  deps.state.wireHydrated.add(sessionID);
  trimSet(deps.state.wireHydrated, HYDRATED_LIMIT);
  if (!deps.storage) return;
  const stored = await deps.storage
    .get(storageKey(sessionID))
    .catch(() => undefined);
  if (
    typeof stored === "string" &&
    stored.length > 0 &&
    stored.length <= 200 &&
    !deps.state.wireSessions.has(sessionID)
  ) {
    deps.state.wireSessions.set(sessionID, stored);
  }
}

function persistWireSessionID(
  deps: Deps,
  sessionID: string,
  wireID: string,
): void {
  if (!deps.storage) return;
  void deps.storage
    .set(storageKey(sessionID), wireID)
    .catch((error) =>
      deps.log.warn("Could not persist the free-pi provider session", {
        sessionID,
        error: String((error as any)?.message ?? error),
      }),
    );
}

/**
 * Records that a turn ended without a clean stream (aborted, interrupted or
 * failed mid-flight). The server can keep the per-session request slot locked
 * in that case, so the next turn must not reuse the id: it would get a
 * `429 concurrent` and OpenCode would show a retry. The next `model.request`
 * rotates to a fresh id instead and the turn continues normally.
 */
export function markWireSessionDirty(deps: Deps, sessionID: string): void {
  if (!sessionID) return;
  deps.state.dirtySessions.add(sessionID);
  trimSet(deps.state.dirtySessions, DIRTY_LIMIT);
}

export function takeWireSessionDirty(deps: Deps, sessionID: string): boolean {
  return deps.state.dirtySessions.delete(sessionID);
}

/** Points the OpenCode session at a fresh wire id and returns it. */
export function rotateWireSessionID(deps: Deps, sessionID: string): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  const next = `${sessionID}-r${suffix}`;
  deps.state.wireSessions.set(sessionID, next);
  deps.state.wireHydrated.add(sessionID);
  persistWireSessionID(deps, sessionID, next);
  return next;
}

export function forgetWireSessionID(deps: Deps, sessionID: string): void {
  deps.state.wireSessions.delete(sessionID);
  deps.state.wireHydrated.delete(sessionID);
  deps.state.dirtySessions.delete(sessionID);
  if (deps.storage) {
    void deps.storage
      .remove(storageKey(sessionID))
      .catch(() => undefined);
  }
}
