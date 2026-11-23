/** Registers the session hooks used by the free-pi providers. */

import type { Plugin } from "@opencode/plugin";
import { ensureAdImpression } from "../ads/impression.js";
import { resolveAdTurn } from "../ads/resolve.js";
import type { AdTurn } from "../types.js";
import { resolveToken } from "../auth/token.js";
import {
  AD_CONTEXT_HEADER,
  AD_CONTEXT_OPT_OUT,
  CONCURRENT_RETRY_BASE_MS,
  CONCURRENT_RETRY_MAX,
  CONCURRENT_RETRY_MAX_DELAY_MS,
  CONTEXT_DIET_MIN_TOKENS,
  CONTEXT_DIET_SHARE,
  DEFENSE_PROVIDER_ID,
  FREE_PI_COMPACTION_GUIDANCE,
  FREE_PI_COMPACTION_MARKER,
  FREE_PI_GUIDANCE,
  FREE_PI_GUIDANCE_MARKER,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_CEILING,
  PROVIDER_ID,
  RECENT_WINDOW_CARRY_MARKER,
  RECENT_WINDOW_CARRY_MS,
  RECENT_WINDOW_MARKER,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_MAX_RETRIES,
  SUBAGENT_HEADER,
  TRANSPORT_RETRY_BASE_MS,
  TRANSPORT_RETRY_MAX,
  TRANSPORT_RETRY_MAX_DELAY_MS,
  TURN_REMINDER,
  TURN_REMINDER_MARKER,
} from "../constants.js";
import {
  currentLiveLimits,
  learnedContextWindow,
  noteRejectedPrompt,
} from "../catalog/live.js";
import type { Deps } from "../deps.js";
import { closeFreePiSession } from "../api/session.js";
import {
  rewriteContextOverflowResponse,
  rewriteLimitResponse,
} from "../errors/limit.js";
import { parseFreePiError } from "../errors/parse.js";
import { trimMap } from "../utils/async.js";
import { pruneStaleToolResults } from "./diet.js";
import { trimMessagesForBudget, estimateMessageTokens } from "./overflow.js";
import { buildRecentWindow, carriedWindowGuidance, recentWindowGuidance } from "./recent.js";
import type { RecentWindow } from "./recent.js";
import { watchFreePiNotice } from "./notices.js";
import {
  clearSpuriousOverflows,
  noteSpuriousOverflow,
  overflowingSpuriously,
  spuriousOverflowResponse,
} from "./overflow.js";
import {
  rememberReplayBody,
  replayConcurrentResponse,
  replaySpuriousOverflow,
  type OverflowReplay,
} from "./replay.js";
import { localTitle } from "./title.js";
import { rememberFreePiSession } from "./track.js";
import {
  hydrateWireSessionID,
  markWireSessionDirty,
  rotateWireSessionID,
  takeWireSessionDirty,
  wireSessionID,
} from "./wire.js";
import {
  FREE_PI_TOOL_NAMES,
  isFreePiSession,
  recordCompaction,
  recordToolEnd,
  recordToolStart,
  toolHeaders,
} from "./tools.js";
import { rememberTrackedModel } from "./usage.js";

type Registration = { dispose: () => Promise<void> };
type SessionHookName =
  | "context"
  | "compaction"
  | "generate"
  | "title"
  | "model.request"
  | "http.request"
  | "http.response"
  | "retry";
type RequestKind = "primary" | "compaction" | "generate" | "title";

const PENDING_LIMIT = 400;

/** Each agent gets its own ad turn, so a subagent never reuses the parent's. */
function pendingKeyOf(
  sessionID: string,
  agent: string | undefined,
  kind: string,
): string {
  return `${sessionID}\u0000${agent ?? ""}\u0000${kind}`;
}

function isFreePiProvider(providerID: string | undefined): boolean {
  return providerID === PROVIDER_ID || providerID === DEFENSE_PROVIDER_ID;
}

function rememberPending(deps: Deps, key: string, turn: AdTurn): void {
  trimMap(deps.state.pendingAdTurns, PENDING_LIMIT);
  deps.state.pendingAdTurns.set(key, turn);
}

/**
 * Fits the compaction request inside the ceiling the gateway has already
 * proven. OpenCode aborts the turn ("the compaction request cannot be reduced
 * further") when the summarizer request is rejected too, so the plugin drops
 * the oldest user turns before that can happen.
 */
function fitCompactionMessages(
  deps: Deps,
  event: any,
  reserveTokens = 0,
): void {
  const modelID = typeof event.model?.id === "string" ? event.model.id : "";
  const ceiling = learnedContextWindow(currentLiveLimits(), modelID);
  if (!ceiling) return;
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;
  const budget = Math.max(
    1_000,
    Math.floor(ceiling * 0.9) - Math.max(0, reserveTokens),
  );
  const trimmed = trimMessagesForBudget(messages, budget);
  if (trimmed.dropped === 0) return;
  event.messages = [...trimmed.messages];
  deps.log.warn(
    "free-pi trimmed the compaction request to fit the learned window",
    {
      sessionID: event.sessionID,
      model: modelID,
      window: ceiling,
      droppedMessages: trimmed.dropped,
      promptTokens: trimmed.tokens,
    },
  );
}

/** Adds a system block once, without mutating the array OpenCode may reuse. */
function appendSystemGuidance(
  event: any,
  text: string,
  marker: string,
): void {
  const system = Array.isArray(event.system) ? event.system : [];
  if (
    system.some(
      (part: any) =>
        part?.type === "text" &&
        typeof part.text === "string" &&
        part.text.startsWith(marker),
    )
  ) {
    return;
  }
  // A fresh array: OpenCode reuses the event across hooks, and pushing into the
  // shared array would carry this block into the next, unrelated request.
  event.system = [...system, { type: "text", text }];
}

/**
 * Removes guidance blocks that belong to another kind of request. OpenCode can
 * hand the same event to several hooks, so the compaction rules have to be
 * stripped before a primary turn: otherwise the model reads them as an order to
 * answer with a summary and burns the turn writing "## Objective / ## Work
 * State" instead of doing the work.
 */
function stripSystemGuidance(event: any, markers: readonly string[]): void {
  if (!Array.isArray(event.system)) return;
  const kept = event.system.filter(
    (part: any) =>
      !(
        part?.type === "text" &&
        typeof part.text === "string" &&
        markers.some((marker) => part.text.startsWith(marker))
      ),
  );
  if (kept.length !== event.system.length) event.system = kept;
}

/**
 * Reads the newest turns of the session from the native API. That history is
 * the only place where the work done just before a compaction still exists
 * verbatim: OpenCode's own request carries a shortened transcript, and after
 * the compaction it keeps only the latest exchange.
 */
async function recentWindowForSession(
  deps: Deps,
  event: any,
): Promise<RecentWindow | undefined> {
  if (typeof event.sessionID !== "string" || event.sessionID.length === 0) {
    return undefined;
  }
  const history = await deps.readContext(event.sessionID).catch(() => []);
  if (!Array.isArray(history) || history.length === 0) return undefined;
  return buildRecentWindow(history);
}

/**
 * Sends the window both in the system prompt and at the end of the request.
 * Free models ignore rules buried up front, but they do read the last message.
 */
function applyRecentWindow(
  deps: Deps,
  event: any,
  window: RecentWindow,
): void {
  const guidance = recentWindowGuidance(window);
  appendSystemGuidance(event, guidance, RECENT_WINDOW_MARKER);
  const messages = Array.isArray(event.messages) ? event.messages : [];
  const already = messages.some((message: any) =>
    Array.isArray(message?.content)
      ? message.content.some(
          (part: any) =>
            part?.type === "text" &&
            typeof part.text === "string" &&
            part.text.startsWith(RECENT_WINDOW_MARKER),
        )
      : false,
  );
  if (!already) {
    // A fresh array: OpenCode reuses the event across hooks, and appending to
    // the shared array would carry this block into the stored conversation and
    // the next, unrelated request.
    event.messages = [
      ...messages,
      { role: "user", content: [{ type: "text", text: guidance }] },
    ];
  }
  // Keep the same text for the next request: if the summary compressed the
  // newest turns anyway, the agent still sees what it was doing.
  trimMap(deps.state.recentWindows, PENDING_LIMIT);
  deps.state.recentWindows.set(event.sessionID, {
    at: Date.now(),
    text: window.text,
  });
  deps.log.info(
    "free-pi quoted the newest turns into the compaction summary",
    {
      sessionID: event.sessionID,
      model: event.model?.id,
      messages: window.messages,
      chars: window.text.length,
      truncated: window.truncated,
    },
  );
}

/**
 * Hands the window saved at the last compaction to the first request after it,
 * once. A stale entry is dropped instead of carried: the summary is the history
 * by then.
 */
function appendCarriedWindow(deps: Deps, event: any): void {
  if (typeof event.sessionID !== "string" || event.sessionID.length === 0) {
    return;
  }
  const carried = deps.state.recentWindows.get(event.sessionID);
  if (!carried) return;
  deps.state.recentWindows.delete(event.sessionID);
  if (Date.now() - carried.at > RECENT_WINDOW_CARRY_MS) return;
  appendSystemGuidance(
    event,
    carriedWindowGuidance(carried.text),
    RECENT_WINDOW_CARRY_MARKER,
  );
}

/**
 * Puts the two rules weak free models forget on long conversations at the end
 * of a primary request. The ad turn is resolved before this runs, so the
 * reminder never leaks into `x-ad-context`. A fresh array keeps it out of the
 * stored conversation and out of a later compaction request.
 */
function appendTurnReminder(event: any): void {
  const messages = Array.isArray(event.messages) ? event.messages : [];
  const already = messages.some((message: any) =>
    Array.isArray(message?.content)
      ? message.content.some(
          (part: any) =>
            part?.type === "text" &&
            typeof part.text === "string" &&
            part.text.startsWith(TURN_REMINDER_MARKER),
        )
      : false,
  );
  if (already) return;
  event.messages = [
    ...messages,
    { role: "user", content: [{ type: "text", text: TURN_REMINDER }] },
  ];
}

/**
 * Collapses stale tool payloads before a request goes out. Long free-pi
 * sessions reach 100k-170k token prompts, and at that size the free models
 * lose the middle of the conversation and stop following the working rules
 * even though the gateway accepts the request. User wording, assistant text
 * and the newest messages are never touched; only old `read`/`grep`/`shell`
 * results are shortened, with a note that says they were pruned.
 */
function applyContextDiet(deps: Deps, event: any): void {
  const providerID = event.model?.providerID;
  const modelID = event.model?.id;
  if (typeof providerID !== "string" || typeof modelID !== "string") return;
  const context = deps.state.contextLimits.get(`${providerID}/${modelID}`);
  if (!context || context <= CONTEXT_DIET_MIN_TOKENS) return;
  const budget = Math.max(
    CONTEXT_DIET_MIN_TOKENS,
    Math.floor(context * CONTEXT_DIET_SHARE),
  );
  if (budget >= context) return;
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;
  const result = pruneStaleToolResults(messages, budget, estimateMessageTokens);
  if (result.pruned === 0) return;
  event.messages = [...result.messages];
  deps.log.info(
    "free-pi pruned stale tool results so the prompt stays attended",
    {
      sessionID: event.sessionID,
      model: modelID,
      context,
      budget,
      pruned: result.pruned,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
    },
  );
}

/**
 * Drops the reasoning OpenCode stores and echoes back inside assistant
 * messages.
 *
 * The provider request carries it as `reasoning_content`, but it is not input:
 * the gateway billed it on some models (a measured glm-5.3-flash request went
 * from 27 to 188 prompt tokens with the same answer) and the token estimate used
 * for diet/compaction assumes it is not sent. Removing it keeps the request
 * identical in behavior and smaller in credits.
 */
function stripAssistantReasoning(deps: Deps, event: any): void {
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;
  let chars = 0;
  let changed = false;
  const next = messages.map((message: any) => {
    if (!message || message.role !== "assistant") return message;
    let copy: any | undefined;
    const ensureCopy = () => {
      if (!copy) copy = { ...message };
      return copy;
    };
    for (const key of ["reasoning_content", "reasoning"] as const) {
      if (!(key in message)) continue;
      const value = message[key];
      if (typeof value === "string") chars += value.length;
      ensureCopy();
      delete copy[key];
      changed = true;
    }
    if (Array.isArray(message.content)) {
      const kept = message.content.filter(
        (part: any) => part?.type !== "reasoning" && part?.type !== "thinking",
      );
      if (kept.length !== message.content.length) {
        ensureCopy();
        copy.content = kept;
        changed = true;
      }
    }
    return copy ?? message;
  });
  if (!changed) return;
  event.messages = next;
  if (chars > 0) {
    deps.log.info("free-pi dropped stored reasoning from the request", {
      sessionID: event.sessionID,
      chars,
    });
  }
}

/** Caps output tokens, applies the efficiency rule and derives the ad turn. */
async function applyGeneration(
  deps: Deps,
  event: any,
  kind: RequestKind,
): Promise<void> {
  if (!isFreePiProvider(event.model?.providerID)) return;
  rememberFreePiSession(deps, event.sessionID);

  // V1 disabled the title agent. OpenCode still asks for a title, so answer
  // from the first user message: no free-pi request, no ad impression, and the
  // session leaves the "New session" state immediately.
  if (kind === "title") {
    event.result = localTitle(event.messages);
    return;
  }

  stripAssistantReasoning(deps, event);

  const modelID = event.model?.id;
  // Remember the choice so a `model_requires_credits` failure can hide exactly
  // the model that was rejected instead of the whole provider.
  if (typeof event.sessionID === "string" && typeof modelID === "string") {
    deps.state.lastModelBySession.set(
      event.sessionID,
      `${event.model.providerID}/${modelID}`,
    );
  }
  const limit = deps.state.outputLimits.get(
    `${event.model.providerID}/${modelID}`,
  );
  // The compaction summary is the one response that must never be cut: a
  // summary that reaches the output limit fails the whole compaction and the
  // turn stops with nothing but the checkpoint. Leave OpenCode's own budget
  // for it and only cap the answers the user reads.
  const cap = Math.min(limit ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_CEILING);
  if (event.options && kind !== "compaction") {
    const current = event.options.maxTokens;
    if (current === undefined || current > cap) event.options.maxTokens = cap;
  }

  if (kind === "compaction") {
    // Quote the newest turns first: they must survive the trim below, because
    // OpenCode keeps only the last exchange beside the summary afterwards.
    const window = await recentWindowForSession(deps, event);
    const reserve = window
      ? Math.ceil(recentWindowGuidance(window).length / 4)
      : 0;
    fitCompactionMessages(deps, event, reserve);
    appendSystemGuidance(
      event,
      FREE_PI_COMPACTION_GUIDANCE,
      FREE_PI_COMPACTION_MARKER,
    );
    if (window) applyRecentWindow(deps, event, window);
    // OpenCode sends the messages it is folding into the summary, which is the
    // same set pi reports through `session_before_compact`.
    recordCompaction(
      deps,
      event.sessionID,
      Array.isArray(event.messages) ? event.messages.length : 0,
    );
    // The compaction request and the next turn overlap: the runner starts the
    // next step while the gateway still holds this wire session's request slot,
    // which costs a `429 concurrent` and a full replay every time. Rotating the
    // id for the next request avoids that round trip without changing what the
    // model receives (the whole compacted history goes out every time).
    markWireSessionDirty(deps, event.sessionID);
  } else if (kind === "primary") {
    // The free models tend to skip planning and claim work they did not do;
    // the CLI gets a much larger agent prompt. This is the compact equivalent.
    stripSystemGuidance(event, [FREE_PI_COMPACTION_MARKER]);
    appendSystemGuidance(event, FREE_PI_GUIDANCE, FREE_PI_GUIDANCE_MARKER);
    applyContextDiet(deps, event);
    appendCarriedWindow(deps, event);
  } else {
    stripSystemGuidance(event, [FREE_PI_COMPACTION_MARKER]);
    applyContextDiet(deps, event);
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

  // After the ad turn: the reminder must not be mistaken for the user prompt.
  if (kind === "primary") appendTurnReminder(event);
}

/** Adds auth and per-turn ad headers to the outgoing model request. */
async function applyModelRequest(deps: Deps, event: any): Promise<void> {
  const providerID = event.model?.providerID;
  if (!isFreePiProvider(providerID)) return;
  rememberFreePiSession(deps, event.sessionID);

  const agent = event.agent ?? (event.kind === "title" ? "title" : undefined);
  event.headers ??= {};
  // Reconnect to the provider session saved for this OpenCode session. A
  // previous turn that was aborted, interrupted or failed mid-stream may have
  // left its per-session request slot locked on the server. Rotating before the
  // request goes out keeps this turn running instead of surfacing a 429 and a
  // retry: the session simply continues under a fresh wire id.
  await hydrateWireSessionID(deps, event.sessionID);
  if (takeWireSessionDirty(deps, event.sessionID)) {
    const previous = wireSessionID(deps, event.sessionID);
    const next = rotateWireSessionID(deps, event.sessionID);
    void closeFreePiSession(deps, previous).catch(() => undefined);
    deps.log.info(
      "free-pi session ended mid-stream; continuing with a fresh session id",
      { sessionID: event.sessionID, from: previous, to: next },
    );
  } else if (!deps.state.wireSessions.has(event.sessionID)) {
    // First request in this process. A previous OpenCode run may have left the
    // session's slot locked, so start from a fresh id instead of reopening it.
    rotateWireSessionID(deps, event.sessionID);
  }
  const token = await resolveToken(deps);
  if (token) event.headers.authorization = `Bearer ${token}`;
  event.headers["x-session-id"] = wireSessionID(deps, event.sessionID);
  event.headers["x-client-version"] = deps.state.latestClientVersion;
  if (deps.state.subagentSessions.has(event.sessionID)) {
    event.headers[SUBAGENT_HEADER] = "1";
  }

  // Title requests are suppressed by the title hook, so an ad for them would be
  // an impression the user never sees.
  if (event.kind === "title") return;

  Object.assign(
    event.headers,
    toolHeaders(deps, event.sessionID, event.kind !== "compaction"),
  );

  const pending = deps.state.pendingAdTurns.get(
    pendingKeyOf(event.sessionID, agent, event.kind),
  );
  const turn =
    pending ??
    (await resolveAdTurn(deps, {
      sessionID: event.sessionID,
      agent,
      kind: event.kind,
      messages: [],
    }).catch(() => undefined));
  if (!turn) return;

  event.headers["x-turn-id"] = turn.turnId;
  // The provider expects ad context on every request of the turn; compaction
  // reuses the turn but explicitly opts out so it never rotates the ad.
  event.headers[AD_CONTEXT_HEADER] =
    event.kind === "compaction"
      ? AD_CONTEXT_OPT_OUT
      : (turn.context ?? AD_CONTEXT_OPT_OUT);
  if (token && event.kind !== "compaction") {
    // V1 awaited the first ad fetch for the turn so the impression lands
    // before the model request. Later steps reuse the settled promise.
    // Compaction opts out of the ad context, so it must not fetch or record a
    // new impression for a request the user never sees.
    await ensureAdImpression(deps, token, event.sessionID, turn).catch(
      () => undefined,
    );
  }
}

/** `concurrent` is free-pi's per-session 429 ("one request at a time"). */
function isConcurrentFailure(error: any): boolean {
  if (!error) return false;
  const body =
    typeof error.response?.body === "string" ? error.response.body : "";
  const message = typeof error.message === "string" ? error.message : "";
  return (
    /one request at a time/i.test(message) ||
    /one request at a time/i.test(body) ||
    /"concurrent"/.test(body)
  );
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

const TERMINAL_RETRY_PATTERN =
  /free usage limit|monthly usage limit|available balance|insufficient_quota|out of budget|quota exceeded|billing|subscription_sharing_usage_limit_exceeded/i;

/**
 * A request that never reached the gateway. `provider.transport` covers the
 * typed path, while the pattern catches bare fetch errors. These are worth
 * retrying beyond the usual budget: a brief offline moment or a background
 * service restart is not a provider limit.
 */
const TRANSPORT_RETRY_PATTERN =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPIPE|socket hang up|fetch failed|Unable to connect|connection (?:refused|reset)/i;

function isTransportFailure(error: any): boolean {
  const type = typeof error?.type === "string" ? error.type : "";
  if (/transport|network|connection/i.test(type)) return true;
  const message = `${error?.message ?? ""}\n${error?.cause?.message ?? ""}`;
  return TRANSPORT_RETRY_PATTERN.test(message);
}

function isTerminalFailure(error: any): boolean {
  if (
    error?.type === "aborted" ||
    /aborted|cancelled|canceled|interrupted|AbortError/i.test(
      `${error?.message ?? ""}`,
    )
  ) {
    return true;
  }
  const parsed = parseFreePiError(error, true);
  if (parsed?.code && TERMINAL_RETRY_CODES.has(parsed.code)) return true;
  const body =
    typeof error?.response?.body === "string" ? error.response.body : "";
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
function applyRetryPolicy(deps: Deps, event: any): void {
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
      delay: Math.min(
        CONCURRENT_RETRY_BASE_MS * 2 ** (event.attempt - 1),
        CONCURRENT_RETRY_MAX_DELAY_MS,
      ),
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
  if (isTransportFailure(event.error)) {
    if (event.attempt > TRANSPORT_RETRY_MAX + 1) {
      event.decision = { retry: false };
      return;
    }
    // A connection that dropped mid-turn can leave the gateway's per-session
    // slot marked busy, so the next attempt should not reuse the wire id.
    markWireSessionDirty(deps, event.sessionID);
    const attempt = Math.max(1, event.attempt - 1);
    event.decision = {
      retry: true,
      delay: Math.min(
        TRANSPORT_RETRY_BASE_MS * 2 ** (attempt - 1),
        TRANSPORT_RETRY_MAX_DELAY_MS,
      ),
    };
    deps.log.warn("free-pi could not be reached; retrying", {
      sessionID: event.sessionID,
      attempt: event.attempt,
      delay: event.decision.delay,
      error: typeof event.error?.message === "string" ? event.error.message : undefined,
    });
    return;
  }
  if (event.attempt > RETRY_MAX_RETRIES + 1) {
    event.decision = { retry: false };
    return;
  }
  if (!event.decision?.retry) return;
  const attempt = Math.max(1, event.attempt - 1);
  event.decision.delay = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    RETRY_MAX_DELAY_MS,
  );
}

/**
 * Removes this plugin's tools from a request served by another provider. The
 * tool editor is global, so without this every model would see `look_at_image`,
 * `web_search` and the rest in its prompt even though their execution refuses
 * non-free-pi sessions. The session's own (not another provider's) tool list is
 * what the model receives, so this keeps free-pi's tools to free-pi models.
 */
function hideFreePiTools(event: any): void {
  if (isFreePiProvider(event.model?.providerID)) return;
  const tools = event.tools;
  if (!tools || typeof tools !== "object") return;
  for (const name of FREE_PI_TOOL_NAMES) {
    if (Object.hasOwn(tools, name)) delete tools[name];
  }
}

async function registerToolHooks(
  ctx: Plugin.Context,
  deps: Deps,
  registrations: Registration[],
): Promise<void> {
  if (!ctx.tool?.hook) return;
  registrations.push(
    await ctx.tool.hook("execute.before", (event) => {
      recordToolStart(deps, event.sessionID, event.id);
    }),
  );
  registrations.push(
    await ctx.tool.hook("execute.after", (event) => {
      recordToolEnd(deps, event.sessionID, {
        id: event.id,
        tool: event.tool,
        status: event.status,
        ...(event.status === "completed" ? { result: event.result } : {}),
      });
      nudgeFailedTool(deps, event);
      replaceUnsupportedImages(deps, event);
    }),
  );
}

/**
 * Adds the concrete next step to a tool failure the free models repeat.
 *
 * The scan of a week of sessions shows the same failures over and over: the
 * portable shell scanner rejects a heredoc or a nested-quote one-liner (72
 * times), `edit` gets identical strings (12) or an ambiguous `oldString` (8).
 * The model reads the bare error and often repeats the call. The hint is short
 * and only goes to free-pi sessions; other providers keep their own messages.
 */
function nudgeFailedTool(deps: Deps, event: any): void {
  if (event.status !== "error") return;
  if (!isFreePiSession(deps, event.sessionID)) return;
  const error = event.error;
  if (!error || typeof error !== "object") return;
  const message = typeof error.message === "string" ? error.message : "";
  if (!message) return;
  let hint = "";
  if (message.includes("Portable shell scanner cannot analyze command")) {
    hint =
      " Write the script to a file with the write tool and run that file; on Windows use PowerShell cmdlets instead of cmd syntax.";
  } else if (/No changes to apply: oldString and newString are identical/i.test(message)) {
    hint =
      " Change the replacement text: oldString and newString must differ. Re-read the line you want to change first.";
  } else if (/Found \d+ matches? for oldString/i.test(message)) {
    hint =
      " Include enough surrounding lines so oldString matches exactly once, or set replaceAll when every occurrence must change.";
  } else if (/has not been read yet|read it before/i.test(message)) {
    hint = " Read the file with the read tool in this turn before editing it.";
  }
  if (!hint) return;
  try {
    error.message = `${message}${hint}`;
  } catch {
    // A frozen error still reaches the model unchanged; the hint is best effort.
  }
}

/**
 * Models whose upstream accepts images get them natively, so a `read` that
 * returns a picture must keep the file part. Text-only models would turn it
 * into an error, so the image is swapped for a pointer to `look_at_image` when
 * the tool settles: the base64 payload never enters the session (or a later
 * compaction) instead of being stored only to be discarded at request time.
 */
function replaceUnsupportedImages(deps: Deps, event: any): void {
  if (event.status !== "completed") return;
  if (!isFreePiSession(deps, event.sessionID)) return;
  const tracked = deps.state.trackedModels.get(event.sessionID);
  if (
    tracked &&
    deps.state.imageModels.has(`${tracked.providerID}/${tracked.modelID}`)
  ) {
    return;
  }
  const content = event.result?.content;
  if (!Array.isArray(content)) return;
  const replaced = content.map((part: any) => {
    if (part?.type !== "file" || typeof part.mime !== "string") return part;
    if (!part.mime.toLowerCase().startsWith("image/")) return part;
    const name = typeof part.name === "string" ? part.name : part.mime;
    const requested =
      typeof event.input?.path === "string" ? event.input.path : name;
    return {
      type: "text",
      text: `ERROR: Cannot read "${name}" (this free-pi model takes text only). If you need its content, call look_at_image with path "${requested}" and a specific question, or switch to a model that accepts image input.`,
    };
  });
  if (replaced.every((part, index) => part === content[index])) return;
  event.result = { ...event.result, content: replaced };
}

async function hookForProviders(
  ctx: Plugin.Context,
  name: SessionHookName,
  callback: (event: any) => Promise<void> | void,
  registrations: Registration[],
): Promise<void> {
  for (const providerID of [PROVIDER_ID, DEFENSE_PROVIDER_ID]) {
    registrations.push(
      await ctx.session.hook(name as any, callback as any, {
        providerID,
      } as any),
    );
  }
}

export async function registerSessionHooks(
  ctx: Plugin.Context,
  deps: Deps,
): Promise<Registration[]> {
  const registrations: Registration[] = [];
  const generation = (kind: RequestKind) => (event: any) =>
    applyGeneration(deps, event, kind);

  await hookForProviders(ctx, "context", generation("primary"), registrations);
  await hookForProviders(
    ctx,
    "compaction",
    generation("compaction"),
    registrations,
  );
  await hookForProviders(ctx, "generate", generation("generate"), registrations);
  await hookForProviders(ctx, "title", generation("title"), registrations);
  // The generation hooks above only run for free-pi providers. These unscoped
  // ones strip the plugin's tools from every other provider's requests.
  for (const name of ["context", "compaction", "generate"] as const) {
    registrations.push(
      await ctx.session.hook(name as any, ((event: any) => {
        hideFreePiTools(event);
      }) as any),
    );
  }
  // Track the model of every request, not only free-pi's: the tool gate and
  // the usage handler must know when a session switches to another provider,
  // otherwise a session that used free-pi once would keep its tools armed.
  registrations.push(
    await ctx.session.hook("model.request" as any, ((event: any) => {
      const providerID = event.model?.providerID;
      if (
        typeof providerID === "string" &&
        typeof event.sessionID === "string" &&
        event.sessionID
      ) {
        rememberTrackedModel(
          deps,
          event.sessionID,
          providerID,
          event.model?.id ?? "",
        );
      }
    }) as any),
  );
  await hookForProviders(
    ctx,
    "model.request",
    (event: any) => applyModelRequest(deps, event),
    registrations,
  );
  await hookForProviders(
    ctx,
    "http.request",
    (event: any) => rememberReplayBody(deps, event),
    registrations,
  );
  await hookForProviders(
    ctx,
    "http.response",
    async (event: any) => {
      // Recover a per-session `429 concurrent` before OpenCode sees it: the
      // step's prepared request is reused on retry, so rotating the id in the
      // retry hook is too late for the failed attempt.
      const replayed = await replayConcurrentResponse(deps, event).catch(
        () => undefined,
      );
      const response = replayed ?? event.response;
      // Context overflow has to be handled first: a 429 context ceiling must
      // become a 400 overflow, not a friendly long-lived limit.
      const overflow = await rewriteContextOverflowResponse(response).catch(
        () => undefined,
      );
      if (overflow) {
        const code =
          overflow.headers.get("x-free-pi-original-code") ?? "context_overflow";
        // A gateway failure can report "too long" for a request that fits the
        // window. Compacting then loops, so retry on a fresh wire session
        // first, and stop compacting once the session has seen a few.
        const reviewed = await replaySpuriousOverflow(deps, event).catch(
          () => ({}) as OverflowReplay,
        );
        // A rejection of a real prompt is the only free measurement of the
        // gateway's ceiling. Attachments inflate the estimate and say nothing
        // about the text window, so they are not learned from.
        if (
          reviewed.spurious === false &&
          typeof reviewed.tokens === "number" &&
          reviewed.model &&
          reviewed.hasMedia !== true
        ) {
          const learned = noteRejectedPrompt(
            deps,
            reviewed.model,
            reviewed.tokens,
          );
          // Re-run the provider transform so this session's next compaction
          // already targets the smaller window; no restart needed.
          if (learned) {
            void ctx.provider.reload().catch(() => undefined);
          }
        }
        if (reviewed.response) {
          clearSpuriousOverflows(deps, event.sessionID);
          event.response = watchFreePiNotice(deps, reviewed.response);
          return;
        }
        if (reviewed.spurious) {
          const count = noteSpuriousOverflow(deps, event.sessionID);
          deps.log.info(
            "free-pi rejected a request as too long that fits the model window",
            {
              sessionID: event.sessionID,
              code,
              tokens: reviewed.tokens,
              rejections: count,
            },
          );
          if (overflowingSpuriously(deps, event.sessionID)) {
            markWireSessionDirty(deps, event.sessionID);
            deps.log.warn(
              "compact loop stopped: free-pi keeps rejecting a request that fits",
              { sessionID: event.sessionID, code, tokens: reviewed.tokens },
            );
            event.response = watchFreePiNotice(
              deps,
              spuriousOverflowResponse(overflow),
            );
            return;
          }
        }
        event.response = watchFreePiNotice(deps, overflow);
        return;
      }
      const rewritten = await rewriteLimitResponse(response).catch(
        () => undefined,
      );
      event.response = watchFreePiNotice(
        deps,
        rewritten ?? response,
      );
    },
    registrations,
  );
  await hookForProviders(
    ctx,
    "retry",
    (event: any) => applyRetryPolicy(deps, event),
    registrations,
  );
  await registerToolHooks(ctx, deps, registrations);

  return registrations;
}
