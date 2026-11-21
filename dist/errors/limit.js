/**
 * Rewrites long-lived free-pi limit responses so the client shows the friendly
 * message instead of a raw 429. Mirrors the fetch wrapper used by the V1 plugin.
 */
import { friendlyFreePiError } from "./messages.js";
const LONG_LIMIT_CODES = new Set([
    "hourly_ceiling",
    "daily_cap",
    "rolling_cap",
    "global_cap",
    "premium_allowance",
    "guest_allowance",
    "concurrent_session",
    "model_requires_credits",
    "insufficient_credits",
    "ads_required",
    "account_review",
    "account_ceiling",
    "region_unavailable",
]);
const CONTEXT_OVERFLOW_CODES = new Set([
    "context_too_long",
    "context_too_long_for_fallback",
    "context_ceiling",
]);
/**
 * OpenCode classifies HTTP 413 as `payload-too-large` before it looks at the
 * message, so free-pi's `context_too_long` 413 never reaches the compaction
 * recovery path. Rewriting it to a 400 whose message matches OpenCode's
 * `prompt is too long` overflow pattern lets the runner compact and retry the
 * turn instead of failing it with the raw server message.
 */
const CONTEXT_OVERFLOW_MESSAGE = "prompt is too long for this model's context window; run /compact or start a new session";
function retryAfterSeconds(response) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
        const seconds = Number.parseFloat(retryAfter);
        if (!Number.isNaN(seconds))
            return seconds;
        const at = Date.parse(retryAfter);
        if (!Number.isNaN(at))
            return Math.max(0, (at - Date.now()) / 1000);
    }
    const retryAfterMs = response.headers.get("retry-after-ms");
    if (retryAfterMs) {
        const ms = Number.parseFloat(retryAfterMs);
        if (!Number.isNaN(ms))
            return ms / 1000;
    }
    return undefined;
}
function limitInfo(body, response) {
    let code;
    let seconds;
    try {
        const data = JSON.parse(body);
        const rawCode = data?.code ?? data?.error?.code ?? data?.limit;
        if (typeof rawCode === "string")
            code = rawCode;
        if (typeof data?.retry_after_seconds === "number") {
            seconds = data.retry_after_seconds;
        }
    }
    catch { }
    seconds ??= retryAfterSeconds(response);
    if (code && LONG_LIMIT_CODES.has(code))
        return { code, retryAfterSeconds: seconds };
    if (seconds !== undefined && seconds > 120) {
        return { code, retryAfterSeconds: seconds };
    }
    return undefined;
}
function friendlyBody(body, info) {
    try {
        const data = JSON.parse(body);
        if (!data || typeof data !== "object")
            return body;
        const error = {
            status: 429,
            code: info.code ?? "unknown",
            message: typeof data.message === "string" ? data.message : undefined,
            retry_after_seconds: info.retryAfterSeconds,
            clears_at: typeof data.clears_at === "string" ? data.clears_at : undefined,
            limit: typeof data.limit === "string" ? data.limit : undefined,
        };
        const friendly = friendlyFreePiError(error);
        data.message = friendly;
        if (data.error && typeof data.error === "object") {
            data.error.message = friendly;
        }
        return JSON.stringify(data);
    }
    catch {
        return body;
    }
}
function contextOverflowCode(body) {
    try {
        const data = JSON.parse(body);
        const raw = data?.code ?? data?.error?.code ?? data?.limit;
        if (typeof raw === "string" && CONTEXT_OVERFLOW_CODES.has(raw))
            return raw;
    }
    catch { }
    return undefined;
}
/**
 * Returns a replacement response when `response` is a free-pi context overflow.
 * The replacement is a 400 with a message OpenCode recognizes as context
 * overflow, so the session runner compacts and retries instead of surfacing
 * the fatal "conversation is too long" error.
 */
export async function rewriteContextOverflowResponse(response) {
    if (response.status !== 413 &&
        response.status !== 429 &&
        response.status !== 400)
        return undefined;
    const body = await response
        .clone()
        .text()
        .catch(() => "");
    if (!body)
        return undefined;
    const code = contextOverflowCode(body);
    if (!code)
        return undefined;
    const headers = new Headers(response.headers);
    headers.delete("retry-after");
    headers.delete("retry-after-ms");
    headers.set("x-free-pi-original-status", String(response.status));
    headers.set("x-free-pi-original-code", code);
    let data;
    try {
        data = JSON.parse(body);
    }
    catch {
        data = {};
    }
    if (data && typeof data === "object") {
        data.message = CONTEXT_OVERFLOW_MESSAGE;
        if (data.error && typeof data.error === "object") {
            data.error.message = CONTEXT_OVERFLOW_MESSAGE;
        }
    }
    return new Response(JSON.stringify(data), {
        status: 400,
        statusText: "Bad Request",
        headers,
    });
}
/**
 * Returns a replacement response when `response` is a 429 that represents a
 * long-lived limit. The replacement is a 400 with the same body but a friendly
 * message, so the model error surface reads it like any other failure.
 */
export async function rewriteLimitResponse(response) {
    if (response.status !== 429)
        return undefined;
    const body = await response
        .clone()
        .text()
        .catch(() => "");
    if (!body)
        return undefined;
    const info = limitInfo(body, response);
    if (!info)
        return undefined;
    const headers = new Headers(response.headers);
    headers.delete("retry-after");
    headers.delete("retry-after-ms");
    headers.set("x-free-pi-original-status", "429");
    return new Response(friendlyBody(body, info), {
        status: 400,
        statusText: "Bad Request",
        headers,
    });
}
