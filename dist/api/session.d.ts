/** Releases free-pi server-side session slots. */
import type { Deps } from "../deps.js";
import type { SessionResetOutcome } from "../types.js";
/**
 * Finalizes the provider session so the account does not stay at its
 * four-session limit. Scoped to `sessionID` when the server honors it.
 */
export declare function closeFreePiSession(deps: Deps, sessionID?: string): Promise<void>;
export declare function resetFreePiSessions(deps: Deps): Promise<SessionResetOutcome>;
