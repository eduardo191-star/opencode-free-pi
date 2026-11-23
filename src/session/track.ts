/**
 * Tracks sessions served by free-pi and closes their server-side slot once the
 * session goes quiet.
 *
 * free-pi limits an account to four concurrent sessions, so every execution has
 * to release its slot. Auxiliary requests such as background compaction can
 * start after the last step, which is why the close is delayed and re-armed by
 * later activity instead of running inline with the execution event.
 */

import { closeFreePiSession } from "../api/session.js";
import {
  SESSION_FINALIZE_DELAY_MS,
  SESSION_TRACK_LIMIT,
} from "../constants.js";
import type { Deps } from "../deps.js";
import { trimMap, trimSet } from "../utils/async.js";
import { forgetWireSessionID, wireSessionID } from "./wire.js";

export function rememberFreePiSession(deps: Deps, sessionID: string): void {
  if (!sessionID) return;
  const sessions = deps.state.freePiSessions;
  sessions.delete(sessionID);
  sessions.add(sessionID);
  trimSet(sessions, SESSION_TRACK_LIMIT);
  touchSessionActivity(deps, sessionID);
}

/** Records free-pi activity so a pending close waits for the request to settle. */
export function touchSessionActivity(deps: Deps, sessionID: string): void {
  if (!sessionID) return;
  const activity = deps.state.sessionActivity;
  activity.delete(sessionID);
  activity.set(sessionID, Date.now());
  trimMap(activity, SESSION_TRACK_LIMIT);

  // A request that arrived after the slot was released (for example a
  // background compaction) reopened it, so close it again once it goes quiet.
  if (
    deps.state.finalizedSessions.has(sessionID) &&
    !deps.state.activeExecutions.has(sessionID)
  ) {
    scheduleFreePiFinalize(deps, sessionID);
  }
}

export function beginExecution(deps: Deps, sessionID: string): void {
  if (!sessionID) return;
  deps.state.activeExecutions.add(sessionID);
  trimSet(deps.state.activeExecutions, SESSION_TRACK_LIMIT);
  cancelFinalizeTimer(deps, sessionID);
  touchSessionActivity(deps, sessionID);
}

export function endExecution(deps: Deps, sessionID: string): void {
  if (!sessionID) return;
  deps.state.activeExecutions.delete(sessionID);
  scheduleFreePiFinalize(deps, sessionID);
}

export function cancelFinalizeTimer(deps: Deps, sessionID: string): void {
  const timer = deps.state.finalizeTimers.get(sessionID);
  if (timer === undefined) return;
  clearTimeout(timer);
  deps.state.finalizeTimers.delete(sessionID);
}

export function cancelAllFinalizeTimers(deps: Deps): void {
  for (const timer of deps.state.finalizeTimers.values()) clearTimeout(timer);
  deps.state.finalizeTimers.clear();
}

/** Closes the session slot after `SESSION_FINALIZE_DELAY_MS` without activity. */
export function scheduleFreePiFinalize(deps: Deps, sessionID: string): void {
  if (!sessionID) return;
  if (!deps.state.freePiSessions.has(sessionID)) return;
  cancelFinalizeTimer(deps, sessionID);

  const attempt = () => {
    deps.state.finalizeTimers.delete(sessionID);
    if (deps.state.activeExecutions.has(sessionID)) return;
    const last = deps.state.sessionActivity.get(sessionID) ?? 0;
    const remaining = SESSION_FINALIZE_DELAY_MS - (Date.now() - last);
    if (remaining > 0) {
      armFinalizeTimer(deps, sessionID, attempt, remaining);
      return;
    }
    void finalizeFreePiSession(deps, sessionID);
  };

  armFinalizeTimer(deps, sessionID, attempt, SESSION_FINALIZE_DELAY_MS);
}

function armFinalizeTimer(
  deps: Deps,
  sessionID: string,
  attempt: () => void,
  delay: number,
): void {
  const timer = setTimeout(attempt, delay);
  // A pending close must never keep the OpenCode process alive.
  (timer as { unref?: () => void }).unref?.();
  deps.state.finalizeTimers.set(sessionID, timer);
}

export async function finalizeFreePiSession(
  deps: Deps,
  sessionID: string,
): Promise<void> {
  if (!sessionID || !deps.state.freePiSessions.has(sessionID)) return;
  deps.state.finalizedSessions.delete(sessionID);
  deps.state.finalizedSessions.add(sessionID);
  trimSet(deps.state.finalizedSessions, SESSION_TRACK_LIMIT);
  // Release the id the session actually sent; a rotated id may be the live one.
  await closeFreePiSession(deps, wireSessionID(deps, sessionID)).catch(
    () => undefined,
  );
}

export function forgetFreePiSession(deps: Deps, sessionID: string): void {
  if (!sessionID) return;
  cancelFinalizeTimer(deps, sessionID);
  // A session evicted from the bounded tracking set never reached
  // `finalizeFreePiSession`, so its server slot would stay open until the
  // gateway times it out. Release it here unless the finalize already did.
  const released = deps.state.finalizedSessions.has(sessionID);
  const wireID = wireSessionID(deps, sessionID);
  deps.state.freePiSessions.delete(sessionID);
  deps.state.finalizedSessions.delete(sessionID);
  deps.state.activeExecutions.delete(sessionID);
  deps.state.sessionActivity.delete(sessionID);
  deps.state.trackedModels.delete(sessionID);
  forgetWireSessionID(deps, sessionID);
  if (!released) {
    void closeFreePiSession(deps, wireID).catch(() => undefined);
  }
}
