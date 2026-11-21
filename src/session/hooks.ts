/** Registers the session hooks used by the free-pi providers. */

import type { Plugin } from "@opencode/plugin";
import { ensureAdImpression } from "../ads/impression.js";
import { resolveAdTurn } from "../ads/resolve.js";
import type { AdTurn } from "../types.js";
import { resolveToken } from "../auth/token.js";
import {
  COST_EXPERIMENT_HEADER,
  DEFENSE_PROVIDER_ID,
  EFFICIENCY_RULE,
  MAX_OUTPUT_TOKENS,
  PROVIDER_ID,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_MAX_RETRIES,
  SUBAGENT_HEADER,
} from "../constants.js";
import type { Deps } from "../deps.js";
import {
  rewriteContextOverflowResponse,
  rewriteLimitResponse,
} from "../errors/limit.js";
import { trimMap } from "../utils/async.js";
import { watchFreePiNotice } from "./notices.js";
import { localTitle } from "./title.js";
import { rememberFreePiSession } from "./track.js";
import {
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
  const cap = Math.min(limit ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
  if (event.options) {
    const current = event.options.maxTokens;
    if (current === undefined || current > cap) event.options.maxTokens = cap;
  }

  if (kind === "compaction") {
    // OpenCode sends the messages it is folding into the summary, which is the
    // same set pi reports through `session_before_compact`.
    recordCompaction(
      deps,
      event.sessionID,
      Array.isArray(event.messages) ? event.messages.length : 0,
    );
  }

  if (deps.state.costExperimentArm === "efficiency") {
    const system = Array.isArray(event.system) ? event.system : [];
    if (
      !system.some(
        (part: any) => part?.type === "text" && part.text === EFFICIENCY_RULE,
      )
    ) {
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
async function applyModelRequest(deps: Deps, event: any): Promise<void> {
  const providerID = event.model?.providerID;
  if (!isFreePiProvider(providerID)) return;
  rememberFreePiSession(deps, event.sessionID);
  rememberTrackedModel(deps, event.sessionID, providerID, event.model?.id ?? "");

  const agent = event.agent ?? (event.kind === "title" ? "title" : undefined);
  event.headers ??= {};
  const token = await resolveToken(deps);
  if (token) event.headers.authorization = `Bearer ${token}`;
  event.headers["x-session-id"] = event.sessionID;
  event.headers["x-client-version"] = deps.state.latestClientVersion;
  if (deps.state.subagentSessions.has(event.sessionID)) {
    event.headers[SUBAGENT_HEADER] = "1";
  }
  if (deps.state.costExperimentArm) {
    event.headers[COST_EXPERIMENT_HEADER] = deps.state.costExperimentArm;
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
  if (token) {
    // V1 awaited the first ad fetch for the turn so the impression lands
    // before the model request. Later steps reuse the settled promise.
    await ensureAdImpression(deps, token, event.sessionID, turn).catch(
      () => undefined,
    );
  }
}

/**
 * pi retries at most three times with `min(2s * 2^(n-1), 60s)`. OpenCode's
 * `attempt` counts the initial call as 1, so pi's attempt is `attempt - 1`.
 * Non-retryable decisions are left alone.
 */
function applyRetryPolicy(event: any): void {
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
    }),
  );
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
    "http.response",
    async (event: any) => {
      // Context overflow has to be handled first: a 429 context ceiling must
      // become a 400 overflow, not a friendly long-lived limit.
      const overflow = await rewriteContextOverflowResponse(
        event.response,
      ).catch(() => undefined);
      if (overflow) {
        event.response = watchFreePiNotice(deps, overflow);
        return;
      }
      const rewritten = await rewriteLimitResponse(event.response).catch(
        () => undefined,
      );
      event.response = watchFreePiNotice(
        deps,
        rewritten ?? event.response,
      );
    },
    registrations,
  );
  await hookForProviders(
    ctx,
    "retry",
    (event: any) => applyRetryPolicy(event),
    registrations,
  );
  await registerToolHooks(ctx, deps, registrations);

  return registrations;
}
