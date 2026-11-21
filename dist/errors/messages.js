/** Human-readable copy for free-pi error codes. */
import { formatRefillTime, formatWait } from "../utils/numbers.js";
const FREE_PI_ERROR_TEXT = {
    daily_cap: "Out of free credits today; refills at UTC midnight.",
    queue_wait: "free-pi is near its daily budget; wait and retry.",
    rolling_cap: "Over the rolling spend cap on the free tier; wait for the retry window.",
    concurrent: "Only one request at a time on the free tier; wait for the current one to finish.",
    concurrent_session: "This account is already at its free-pi session limit. Wait for a slot to free up and retry.",
    context_ceiling: "This conversation is too large for free-pi's context limit.",
    upstream_error: "Upstream model provider had an issue; retry.",
    global_cap: "free-pi is over its shared daily budget; back tomorrow.",
    consent_required: "Consent required. Run `opencode auth login -p free-pi` to review the terms.",
    upgrade_required: "The free-pi client is out of date; update the plugin or free-pi-cli.",
    hourly_ceiling: "Daily allowance still applies; it refills at midnight UTC.",
    account_review: "This account is under review; contact support.",
    ads_required: "Ads are not displaying for this account, so free completions are paused. Run `npx free-pi-cli@latest` so ads can show, then retry.",
    guest_allowance: "Guest trial used up; sign in with GitHub for a larger allowance.",
    guest_unavailable: "Guest access is unavailable right now.",
    guest_login_required: "This needs a GitHub sign-in.",
    region_unavailable: "free-pi is not available in your region.",
    model_requires_credits: "This model needs purchased or premium credits. Switch to a free model.",
    premium_allowance: "Premium allowance used up; switch to a free model or add credits to your account.",
    model_at_capacity: "This model is busy right now; retry or switch models.",
    context_too_long_for_fallback: "This conversation is too long for this model; compact it or switch models.",
    context_too_long: "This conversation is too long; compact it or start a new session.",
    reward_required: "This model is only for reward holders.",
    subagents_unavailable: "Subagents need the free Particle model or purchased credits.",
    unauthorized: "free-pi sign-in is invalid or expired. Run `opencode auth login -p free-pi` to sign in again.",
    expired_token: "free-pi sign-in expired. Run `opencode auth login -p free-pi` to sign in again.",
    insufficient_credits: "This account does not have enough credits for the request. Add credits or switch to a free model.",
    network_error: "Cannot reach free-pi right now. Check your connection and retry.",
    timeout: "The free-pi request timed out. Retry in a moment.",
    rate_limited: "free-pi is rate limiting requests. Wait a moment and retry.",
    content_filter: "The model's reply was blocked by a content filter. Try rephrasing.",
};
const FREE_PI_ERROR_TITLE = {
    daily_cap: "free-pi daily limit",
    queue_wait: "free-pi budget",
    rolling_cap: "free-pi budget",
    global_cap: "free-pi budget",
    hourly_ceiling: "free-pi allowance",
    concurrent: "free-pi busy",
    concurrent_session: "free-pi session limit",
    ads_required: "free-pi ads",
    unauthorized: "free-pi sign-in",
    expired_token: "free-pi sign-in",
    guest_allowance: "free-pi sign-in",
    guest_login_required: "free-pi sign-in",
    guest_unavailable: "free-pi sign-in",
    consent_required: "free-pi consent",
    upgrade_required: "free-pi update",
    region_unavailable: "free-pi unavailable",
    account_review: "free-pi account",
    model_requires_credits: "free-pi credits",
    premium_allowance: "free-pi credits",
    insufficient_credits: "free-pi credits",
    model_at_capacity: "free-pi model",
    context_ceiling: "free-pi context",
    context_too_long: "free-pi context",
    context_too_long_for_fallback: "free-pi context",
    reward_required: "free-pi model",
    subagents_unavailable: "free-pi subagents",
    network_error: "free-pi connection",
    timeout: "free-pi timeout",
    rate_limited: "free-pi busy",
    content_filter: "free-pi response",
    upstream_error: "free-pi upstream",
};
const ERROR_SEVERITY_CODES = new Set([
    "unauthorized",
    "expired_token",
    "ads_required",
    "account_review",
    "region_unavailable",
    "insufficient_credits",
    "model_requires_credits",
    "premium_allowance",
    "guest_allowance",
    "guest_login_required",
    "subagents_unavailable",
    "reward_required",
    "content_filter",
]);
export function freePiErrorTitle(error) {
    return FREE_PI_ERROR_TITLE[error.code] ?? "free-pi error";
}
export function freePiErrorSeverity(error) {
    return ERROR_SEVERITY_CODES.has(error.code) ? "error" : "warn";
}
export function errorResetHint(error) {
    if (error.clears_at) {
        const formatted = formatRefillTime(error.clears_at);
        if (formatted !== "unknown")
            return `at ${formatted}`;
    }
    const wait = formatWait(error.retry_after_seconds);
    return wait ? `in ${wait}` : undefined;
}
export function friendlyFreePiError(error) {
    const reset = errorResetHint(error);
    if (error.code === "hourly_ceiling") {
        return `This account hit its hourly limit; ${reset ? `it resets ${reset}` : "wait for it to reset"}. Switch models or retry later.`;
    }
    if (error.code === "daily_cap") {
        return `Out of free credits today; ${reset ? `it resets ${reset}` : "it refills at UTC midnight"}.`;
    }
    if (error.code === "rolling_cap") {
        return `Over the rolling spend cap; ${reset ? `retry ${reset}` : "wait for the retry window"}.`;
    }
    if (error.code === "queue_wait") {
        return `free-pi is near its daily budget; ${reset ? `retry ${reset}` : "wait and retry"}.`;
    }
    const known = FREE_PI_ERROR_TEXT[error.code];
    if (known)
        return known;
    if (error.message?.trim())
        return error.message.trim();
    return `free-pi request failed${error.status ? ` (HTTP ${error.status})` : ""}${error.code ? ` [${error.code}]` : ""}.`;
}
