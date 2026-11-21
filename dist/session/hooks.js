/** Registers the session hooks used by the free-pi providers. */
import { ensureAdImpression } from "../ads/impression.js";
import { resolveAdTurn } from "../ads/resolve.js";
import { resolveToken } from "../auth/token.js";
import { AD_CONTEXT_HEADER, AD_CONTEXT_OPT_OUT, COST_EXPERIMENT_HEADER, CONCURRENT_RETRY_BASE_MS, CONCURRENT_RETRY_MAX, CONCURRENT_RETRY_MAX_DELAY_MS, DEFENSE_PROVIDER_ID, EFFICIENCY_RULE, MAX_OUTPUT_TOKENS, PROVIDER_ID, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS, RETRY_MAX_RETRIES, SUBAGENT_HEADER, } from "../constants.js";
import { closeFreePiSession } from "../api/session.js";
import { rewriteContextOverflowResponse, rewriteLimitResponse, } from "../errors/limit.js";
import { parseFreePiError } from "../errors/parse.js";
import { trimMap } from "../utils/async.js";
import { watchFreePiNotice } from "./notices.js";
import { rememberReplayBody, replayConcurrentResponse, } from "./replay.js";
import { localTitle } from "./title.js";
import { rememberFreePiSession } from "./track.js";
import { markWireSessionDirty, rotateWireSessionID, takeWireSessionDirty, wireSessionID, } from "./wire.js";
import { recordCompaction, recordToolEnd, recordToolStart, toolHeaders, } from "./tools.js";
import { rememberTrackedModel } from "./usage.js";
const PENDING_LIMIT = 400;
/** Each agent gets its own ad turn, so a subagent never reuses the parent's. */
function pendingKeyOf(sessionID, agent, kind) {
    return `${sessionID}\u0000${agent ?? ""}\u0000${kind}`;
}
function isFreePiProvider(providerID) {
    return providerID === PROVIDER_ID || providerID === DEFENSE_PROVIDER_ID;
}
function rememberPending(deps, key, turn) {
    trimMap(deps.state.pendingAdTurns, PENDING_LIMIT);
    deps.state.pendingAdTurns.set(key, turn);
}
/** Caps output tokens, applies the efficiency rule and derives the ad turn. */
async function applyGeneration(deps, event, kind) {
    if (!isFreePiProvider(event.model?.providerID))
        return;
    rememberFreePiSession(deps, event.sessionID);
    // V1 disabled the title agent. OpenCode still asks for a title, so answer
    // from the first user message: no free-pi request, no ad impression, and the
    // session leaves the "New session" state immediately.
    if (kind === "title") {
        event.result = localTitle(event.messages);
        return;
    }
    const modelID = event.model?.id;
    const limit = deps.state.outputLimits.get(`${event.model.providerID}/${modelID}`);
    const cap = Math.min(limit ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
    if (event.options) {
        const current = event.options.maxTokens;
        if (current === undefined || current > cap)
            event.options.maxTokens = cap;
    }
    if (kind === "compaction") {
        // OpenCode sends the messages it is folding into the summary, which is the
        // same set pi reports through `session_before_compact`.
        recordCompaction(deps, event.sessionID, Array.isArray(event.messages) ? event.messages.length : 0);
    }
    if (deps.state.costExperimentArm === "efficiency") {
        const system = Array.isArray(event.system) ? event.system : [];
        if (!system.some((part) => part?.type === "text" && part.text === EFFICIENCY_RULE)) {
            system.push({ type: "text", text: EFFICIENCY_RULE });
            event.system = system;
        }
    }
    const agent = event.agent;
    const turn = await resolveAdTurn(deps, {
        sessionID: event.sessionID,
        agent,
        kind,
        messages: Array.isArray(event.messages) ? event.messages : [],
    }).catch(() => undefined);
    if (turn) {
        rememberPending(deps, pendingKeyOf(event.sessionID, agent, kind), turn);
    }
}
/** Adds auth and per-turn ad headers to the outgoing model request. */
async function applyModelRequest(deps, event) {
    const providerID = event.model?.providerID;
    if (!isFreePiProvider(providerID))
        return;
    rememberFreePiSession(deps, event.sessionID);
    rememberTrackedModel(deps, event.sessionID, providerID, event.model?.id ?? "");
    const agent = event.agent ?? (event.kind === "title" ? "title" : undefined);
    event.headers ??= {};
    // A previous turn that was aborted, interrupted or failed mid-stream may have
    // left its per-session request slot locked on the server. Rotating before the
    // request goes out keeps this turn running instead of surfacing a 429 and a
    // retry: the session simply continues under a fresh wire id.
    if (takeWireSessionDirty(deps, event.sessionID)) {
        const previous = wireSessionID(deps, event.sessionID);
        const next = rotateWireSessionID(deps, event.sessionID);
        void closeFreePiSession(deps, previous).catch(() => undefined);
        deps.log.info("free-pi session ended mid-stream; continuing with a fresh session id", { sessionID: event.sessionID, from: previous, to: next });
    }
    else if (!deps.state.wireSessions.has(event.sessionID)) {
        // First request in this process. A previous OpenCode run may have left the
        // session's slot locked, so start from a fresh id instead of reopening it.
        rotateWireSessionID(deps, event.sessionID);
    }
    const token = await resolveToken(deps);
    if (token)
        event.headers.authorization = `Bearer ${token}`;
    event.headers["x-session-id"] = wireSessionID(deps, event.sessionID);
    event.headers["x-client-version"] = deps.state.latestClientVersion;
    if (deps.state.subagentSessions.has(event.sessionID)) {
        event.headers[SUBAGENT_HEADER] = "1";
    }
    if (deps.state.costExperimentArm) {
        event.headers[COST_EXPERIMENT_HEADER] = deps.state.costExperimentArm;
    }
    // Title requests are suppressed by the title hook, so an ad for them would be
    // an impression the user never sees.
    if (event.kind === "title")
        return;
    Object.assign(event.headers, toolHeaders(deps, event.sessionID, event.kind !== "compaction"));
    const pending = deps.state.pendingAdTurns.get(pendingKeyOf(event.sessionID, agent, event.kind));
    const turn = pending ??
        (await resolveAdTurn(deps, {
            sessionID: event.sessionID,
            agent,
            kind: event.kind,
            messages: [],
        }).catch(() => undefined));
    if (!turn)
        return;
    event.headers["x-turn-id"] = turn.turnId;
    // The provider expects ad context on every request of the turn; compaction
    // reuses the turn but explicitly opts out so it never rotates the ad.
    event.headers[AD_CONTEXT_HEADER] =
        event.kind === "compaction"
            ? AD_CONTEXT_OPT_OUT
            : (turn.context ?? AD_CONTEXT_OPT_OUT);
    if (token) {
        // V1 awaited the first ad fetch for the turn so the impression lands
        // before the model request. Later steps reuse the settled promise.
        await ensureAdImpression(deps, token, event.sessionID, turn).catch(() => undefined);
    }
}
/** `concurrent` is free-pi's per-session 429 ("one request at a time"). */
function isConcurrentFailure(error) {
    if (!error)
        return false;
    const body = typeof error.response?.body === "string" ? error.response.body : "";
    const message = typeof error.message === "string" ? error.message : "";
    return (/one request at a time/i.test(message) ||
        /one request at a time/i.test(body) ||
        /"concurrent"/.test(body));
}
/**
 * Limits and account blocks do not recover by retrying. pi's own retry helper
 * treats them as terminal (`NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN`), but
 * OpenCode retries every 429 by default, which surfaces as an endless
 * "Retrying…". The response rewrite turns most of these into a 400; this guard
 * covers the rest and keeps the CLI's behavior.
 */
const TERMINAL_RETRY_CODES = new Set([
    "daily_cap",
    "hourly_ceiling",
    "rolling_cap",
    "global_cap",
    "account_ceiling",
    "free_usage_limit",
    "premium_allowance",
    "guest_allowance",
    "model_requires_credits",
    "insufficient_credits",
    "ads_required",
    "account_review",
    "region_unavailable",
    "unauthorized",
    "expired_token",
    "guest_login_required",
    "consent_required",
    "upgrade_required",
    "reward_required",
    "content_filter",
    "subagents_unavailable",
]);
const TERMINAL_RETRY_PATTERN = /free usage limit|monthly usage limit|available balance|insufficient_quota|out of budget|quota exceeded|billing|subscription_sharing_usage_limit_exceeded/i;
function isTerminalFailure(error) {
    if (error?.type === "aborted" ||
        /aborted|cancelled|canceled|interrupted|AbortError/i.test(`${error?.message ?? ""}`)) {
        return true;
    }
    const parsed = parseFreePiError(error, true);
    if (parsed?.code && TERMINAL_RETRY_CODES.has(parsed.code))
        return true;
    const body = typeof error?.response?.body === "string" ? error.response.body : "";
    const message = typeof error?.message === "string" ? error.message : "";
    return TERMINAL_RETRY_PATTERN.test(`${message}\n${body}`);
}
/**
 * pi retries at most three times with `min(2s * 2^(n-1), 60s)`. OpenCode's
 * `attempt` counts the initial call as 1, so pi's attempt is `attempt - 1`.
 * Non-retryable decisions are left alone.
 *
 * The one exception is `concurrent`: OpenCode treats the free-pi 429 as fatal,
 * and the server can leave a per-session lock behind that resets do not clear.
 * Rotating the wire session id and retrying turns that into a normal retry.
 */
function applyRetryPolicy(deps, event) {
    if (isConcurrentFailure(event.error)) {
        if (event.attempt > CONCURRENT_RETRY_MAX) {
            event.decision = { retry: false };
            return;
        }
        const previous = wireSessionID(deps, event.sessionID);
        const next = rotateWireSessionID(deps, event.sessionID);
        // Releasing the old id cleans up an orphaned slot; a leaked live lock
        // ignores reset, which is exactly why the next request uses a fresh id.
        void closeFreePiSession(deps, previous).catch(() => undefined);
        deps.log.info("free-pi session busy; retrying with a fresh session id", {
            sessionID: event.sessionID,
            from: previous,
            to: next,
            attempt: event.attempt,
        });
        event.decision = {
            retry: true,
            delay: Math.min(CONCURRENT_RETRY_BASE_MS * 2 ** (event.attempt - 1), CONCURRENT_RETRY_MAX_DELAY_MS),
        };
        return;
    }
    if (isTerminalFailure(event.error)) {
        // Remember the broken stream too, so the next turn rotates its wire id
        // instead of running into the stale per-session lock.
        markWireSessionDirty(deps, event.sessionID);
        event.decision = { retry: false };
        return;
    }
    if (event.attempt > RETRY_MAX_RETRIES + 1) {
        event.decision = { retry: false };
        return;
    }
    if (!event.decision?.retry)
        return;
    const attempt = Math.max(1, event.attempt - 1);
    event.decision.delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
}
async function registerToolHooks(ctx, deps, registrations) {
    if (!ctx.tool?.hook)
        return;
    registrations.push(await ctx.tool.hook("execute.before", (event) => {
        recordToolStart(deps, event.sessionID, event.id);
    }));
    registrations.push(await ctx.tool.hook("execute.after", (event) => {
        recordToolEnd(deps, event.sessionID, {
            id: event.id,
            tool: event.tool,
            status: event.status,
            ...(event.status === "completed" ? { result: event.result } : {}),
        });
    }));
}
async function hookForProviders(ctx, name, callback, registrations) {
    for (const providerID of [PROVIDER_ID, DEFENSE_PROVIDER_ID]) {
        registrations.push(await ctx.session.hook(name, callback, {
            providerID,
        }));
    }
}
export async function registerSessionHooks(ctx, deps) {
    const registrations = [];
    const generation = (kind) => (event) => applyGeneration(deps, event, kind);
    await hookForProviders(ctx, "context", generation("primary"), registrations);
    await hookForProviders(ctx, "compaction", generation("compaction"), registrations);
    await hookForProviders(ctx, "generate", generation("generate"), registrations);
    await hookForProviders(ctx, "title", generation("title"), registrations);
    await hookForProviders(ctx, "model.request", (event) => applyModelRequest(deps, event), registrations);
    await hookForProviders(ctx, "http.request", (event) => rememberReplayBody(deps, event), registrations);
    await hookForProviders(ctx, "http.response", async (event) => {
        // Recover a per-session `429 concurrent` before OpenCode sees it: the
        // step's prepared request is reused on retry, so rotating the id in the
        // retry hook is too late for the failed attempt.
        const replayed = await replayConcurrentResponse(deps, event).catch(() => undefined);
        const response = replayed ?? event.response;
        // Context overflow has to be handled first: a 429 context ceiling must
        // become a 400 overflow, not a friendly long-lived limit.
        const overflow = await rewriteContextOverflowResponse(response).catch(() => undefined);
        if (overflow) {
            event.response = watchFreePiNotice(deps, overflow);
            return;
        }
        const rewritten = await rewriteLimitResponse(response).catch(() => undefined);
        event.response = watchFreePiNotice(deps, rewritten ?? response);
    }, registrations);
    await hookForProviders(ctx, "retry", (event) => applyRetryPolicy(deps, event), registrations);
    await registerToolHooks(ctx, deps, registrations);
    return registrations;
}
