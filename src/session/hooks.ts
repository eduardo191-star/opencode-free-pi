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
  DEFENSE_PROVIDER_ID,
  FREE_PI_COMPACTION_GUIDANCE,
  FREE_PI_COMPACTION_MARKER,
  FREE_PI_GUIDANCE,
  FREE_PI_GUIDANCE_MARKER,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_CEILING,
  PROVIDER_ID,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_MAX_RETRIES,
  SUBAGENT_HEADER,
} from "../constants.js";
import type { Deps } from "../deps.js";
import { closeFreePiSession } from "../api/session.js";
import {
  rewriteContextOverflowResponse,
  rewriteLimitResponse,
} from "../errors/limit.js";
import { parseFreePiError } from "../errors/parse.js";
import { trimMap } from "../utils/async.js";
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

/** Adds a system block once, even when OpenCode reuses the same event. */
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
  system.push({ type: "text", text });
  event.system = system;
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

  const modelID = event.model?.id;
  const limit = deps.state.outputLimits.get(
    `${event.model.providerID}/${modelID}`,
  );
  // Reasoning shares the output budget; a model that publishes more than the
  // CLI's 32k keeps that larger budget (up to the plugin ceiling).
  const cap = Math.min(limit ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_CEILING);
  if (event.options) {
    const current = event.options.maxTokens;
    if (current === undefined || current > cap) event.options.maxTokens = cap;
  }

  if (kind === "compaction") {
    appendSystemGuidance(
      event,
      FREE_PI_COMPACTION_GUIDANCE,
      FREE_PI_COMPACTION_MARKER,
    );
    // OpenCode sends the messages it is folding into the summary, which is the
    // same set pi reports through `session_before_compact`.
    recordCompaction(
      deps,
      event.sessionID,
      Array.isArray(event.messages) ? event.messages.length : 0,
    );
  } else if (kind === "primary") {
    // The free models tend to skip planning and claim work they did not do;
    // the CLI gets a much larger agent prompt. This is the compact equivalent.
    appendSystemGuidance(event, FREE_PI_GUIDANCE, FREE_PI_GUIDANCE_MARKER);
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
async function applyModelRequest(deps: Deps, event: any): Promise<void> {
  const providerID = event.model?.providerID;
  if (!isFreePiProvider(providerID)) return;
  rememberFreePiSession(deps, event.sessionID);
  rememberTrackedModel(deps, event.sessionID, providerID, event.model?.id ?? "");

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
  if (token) {
    // V1 awaited the first ad fetch for the turn so the impression lands
    // before the model request. Later steps reuse the settled promise.
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
      replaceUnsupportedImages(deps, event);
    }),
  );
}

/**
 * free-pi only accepts text, like the provider CLI. OpenCode already swaps
 * media for this notice when it builds a request for a text-only model, but
 * doing it when the tool settles keeps the base64 image out of the session
 * (and out of compaction) instead of storing hundreds of KB per read.
 */
function replaceUnsupportedImages(deps: Deps, event: any): void {
  if (event.status !== "completed") return;
  if (!isFreePiSession(deps, event.sessionID)) return;
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
      text: `ERROR: Cannot read "${name}" (free-pi models take text only). If you need its content, call look_at_image with path "${requested}" and a specific question.`,
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
