/** Releases free-pi server-side session slots. */
import { resolveToken } from "../auth/token.js";
import { SESSION_RESET_COOLDOWN_MS } from "../constants.js";
import { trimMap } from "../utils/async.js";
import { resolveBaseUrl } from "../utils/urls.js";
const CLOSE_LIMIT = 200;
function resetRequest(deps, token, sessionID) {
    const headers = {
        authorization: `Bearer ${token}`,
        "x-client-version": deps.state.latestClientVersion,
    };
    if (sessionID)
        headers["x-session-id"] = sessionID;
    return fetch(new URL("/session/reset", resolveBaseUrl()), {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(3000),
    });
}
/**
 * Finalizes the provider session so the account does not stay at its
 * four-session limit. Scoped to `sessionID` when the server honors it.
 */
export async function closeFreePiSession(deps, sessionID) {
    const key = sessionID ?? "";
    const existing = deps.state.sessionClosePromises.get(key);
    if (existing)
        return existing;
    const pending = (async () => {
        try {
            const token = await resolveToken(deps);
            if (!token)
                return;
            await resetRequest(deps, token, sessionID).catch(() => undefined);
        }
        finally {
            deps.state.sessionClosePromises.delete(key);
        }
    })();
    trimMap(deps.state.sessionClosePromises, CLOSE_LIMIT);
    deps.state.sessionClosePromises.set(key, pending);
    return pending;
}
export async function resetFreePiSessions(deps) {
    if (Date.now() - deps.state.lastSessionResetAt < SESSION_RESET_COOLDOWN_MS)
        return "cooldown";
    if (deps.state.sessionResetPromise)
        return deps.state.sessionResetPromise;
    deps.state.sessionResetPromise = (async () => {
        try {
            const token = await resolveToken(deps);
            if (!token)
                return "unavailable";
            const response = await resetRequest(deps, token);
            if (!response.ok)
                return "failed";
            const data = (await response.json().catch(() => undefined));
            return data?.released === true ? "released" : "none";
        }
        catch {
            return "failed";
        }
        finally {
            deps.state.lastSessionResetAt = Date.now();
            deps.state.sessionResetPromise = undefined;
        }
    })();
    return deps.state.sessionResetPromise;
}
