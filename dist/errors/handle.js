/** Central handling for free-pi failures reported by the provider or session. */
import { fetchQuota, rememberTokenCheck } from "../api/quota.js";
import { resetFreePiSessions } from "../api/session.js";
import { logInvalidToken } from "./invalid.js";
import { freePiErrorSeverity, freePiErrorTitle, friendlyFreePiError, } from "./messages.js";
import { parseFreePiError } from "./parse.js";
export async function handleFreePiError(deps, error, opts = {}) {
    const parsed = parseFreePiError(error, opts.allowRaw === true);
    if (!parsed)
        return;
    deps.state.lastFreePiError = parsed;
    if (parsed.status === 401 ||
        parsed.code === "unauthorized" ||
        parsed.code === "expired_token") {
        const token = deps.state.quotaCache?.token;
        if (token)
            rememberTokenCheck(deps, token, "invalid");
        await logInvalidToken(deps, token);
        void fetchQuota(deps, { force: true }).catch(() => undefined);
        return;
    }
    let message = friendlyFreePiError(parsed);
    let resetOutcome;
    if (parsed.code === "concurrent_session") {
        resetOutcome = await resetFreePiSessions(deps);
        if (resetOutcome === "released") {
            message =
                "free-pi was at its session limit; freed a stale slot automatically. Retry your request now.";
        }
        else if (resetOutcome === "none") {
            message =
                "free-pi is at its session limit and no other session was running. Wait for a slot to free up and retry.";
        }
        else if (resetOutcome === "failed" || resetOutcome === "unavailable") {
            message =
                "free-pi is at its session limit and the slot could not be freed automatically. Wait a moment and retry.";
        }
        else {
            message =
                "free-pi session reset was just attempted; retry in a moment.";
        }
    }
    const key = `${parsed.code}\u0000${parsed.message ?? ""}`;
    const now = Date.now();
    if (key !== deps.state.lastErrorLogKey || now - deps.state.lastErrorLogAt > 15_000) {
        deps.state.lastErrorLogKey = key;
        deps.state.lastErrorLogAt = now;
        const level = freePiErrorSeverity(parsed);
        deps.log.log(level, `${freePiErrorTitle(parsed)}: ${message}`, {
            code: parsed.code,
            status: parsed.status,
            limit: parsed.limit,
            retry_after_seconds: parsed.retry_after_seconds,
            clears_at: parsed.clears_at,
            reset: resetOutcome,
        });
    }
    if (parsed.status === 402 ||
        parsed.status === 403 ||
        parsed.status === 429 ||
        parsed.limit !== undefined) {
        void fetchQuota(deps, { force: true }).catch(() => undefined);
    }
}
