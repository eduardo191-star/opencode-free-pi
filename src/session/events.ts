/** Subscribes to core events that affect free-pi state. */

import type { Plugin } from "@opencode/plugin";
import { closeFreePiSession } from "../api/session.js";
import { readCredentialsToken } from "../auth/credentials.js";
import { tokenFromCredential } from "../auth/credential.js";
import type { Deps } from "../deps.js";
import { handleFreePiError } from "../errors/handle.js";
import { parseFreePiError } from "../errors/parse.js";
import { noteStepTokens } from "../catalog/live.js";
import { SESSION_TRACK_LIMIT } from "../constants.js";
import { forgetToolStats, isFreePiSession } from "./tools.js";
import { trimSet } from "../utils/async.js";
import {
  beginExecution,
  cancelAllFinalizeTimers,
  endExecution,
  finalizeFreePiSession,
  forgetFreePiSession,
} from "./track.js";
import {
  markWireSessionDirty,
} from "./wire.js";
import { recordUsage } from "./usage.js";

function isAbortLike(error: any): boolean {
  if (!error) return false;
  if (error.type === "aborted") return true;
  return /aborted|cancelled|canceled|interrupted|AbortError/i.test(
    `${error.message ?? ""}`,
  );
}

const EVENT_TYPES = [
  "credential.updated",
  "credential.switched",
  "session.created",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.usage.updated",
  "session.step.ended",
  "session.deleted",
  "location.shutdown",
] as const;

/**
 * Hides a model the gateway rejected with `model_requires_credits`. The error
 * body does not name the model, but the session's last request does; removing
 * it and reloading the provider keeps the picker from offering a choice that
 * always fails on this account.
 */
async function hideRejectedModel(
  ctx: Plugin.Context,
  deps: Deps,
  sessionID: string,
  error: any,
): Promise<void> {
  const parsed = parseFreePiError(error, true);
  if (parsed?.code !== "model_requires_credits") return;
  const key = deps.state.lastModelBySession.get(sessionID);
  if (!key || deps.state.deniedModels.has(key)) return;
  deps.state.deniedModels.add(key);
  deps.log.warn("free-pi hid a model this account cannot use", { model: key });
  await ctx.provider.reload().catch(() => undefined);
  await ctx.model.reload().catch(() => undefined);
}

async function handleEvent(
  ctx: Plugin.Context,
  deps: Deps,
  event: any,
): Promise<void> {
  switch (event.type) {
    case "credential.updated":
    case "credential.switched": {
      const credential = await deps.activeCredential().catch(() => undefined);
      const next =
        tokenFromCredential(credential) ?? (await readCredentialsToken());
      if (next === deps.state.providerToken) return;
      deps.state.providerToken = next;
      // A different sign-in can have premium credits, so re-test every model.
      deps.state.deniedModels.clear();
      await ctx.provider.reload().catch(() => undefined);
      return;
    }
    case "session.created": {
      // The CLI marks requests from its own subagents so the server can bill
      // and rate-limit them separately; OpenCode's children map the same way.
      const sessionID = event.data?.sessionID;
      if (typeof sessionID !== "string") return;
      if (typeof event.data?.parentID === "string") {
        deps.state.subagentSessions.add(sessionID);
        // Bound the set: a child whose deletion event is missed (crash, restart)
        // would otherwise grow it forever and keep marking requests as children.
        trimSet(deps.state.subagentSessions, SESSION_TRACK_LIMIT);
      }
      return;
    }
    case "session.execution.started": {
      const sessionID = event.data?.sessionID;
      if (typeof sessionID === "string" && isFreePiSession(deps, sessionID)) {
        beginExecution(deps, sessionID);
      }
      return;
    }
    case "session.execution.failed": {
      const sessionID = event.data?.sessionID;
      if (typeof sessionID === "string" && isFreePiSession(deps, sessionID)) {
        // A request that dies mid-stream can leave its slot locked on the
        // server. The next turn will use a fresh wire id instead of waiting on
        // a retry.
        if (isAbortLike(event.data?.error)) {
          markWireSessionDirty(deps, sessionID);
        }
        await hideRejectedModel(ctx, deps, sessionID, event.data?.error);
        await handleFreePiError(deps, event.data?.error, {
          allowRaw: true,
        }).catch(() => undefined);
      }
      endExecution(deps, sessionID);
      return;
    }
    case "session.execution.succeeded": {
      endExecution(deps, event.data?.sessionID);
      return;
    }
    case "session.execution.interrupted": {
      const sessionID = event.data?.sessionID;
      if (typeof sessionID === "string" && isFreePiSession(deps, sessionID)) {
        markWireSessionDirty(deps, sessionID);
      }
      endExecution(deps, sessionID);
      return;
    }
    case "session.usage.updated": {
      const sessionID = event.data?.sessionID;
      if (typeof sessionID !== "string" || !isFreePiSession(deps, sessionID)) {
        return;
      }
      recordUsage(deps, sessionID, event.data?.cost, event.data?.tokens);
      return;
    }
    case "session.step.ended": {
      const sessionID = event.data?.sessionID;
      if (typeof sessionID !== "string" || !isFreePiSession(deps, sessionID)) {
        return;
      }
      recordUsage(deps, sessionID, event.data?.cost, event.data?.tokens);
      // Step tokens are per request; usage.updated is cumulative.
      noteStepTokens(
        deps,
        deps.state.trackedModels.get(sessionID)?.modelID ?? "",
        event.data?.tokens,
      );
      return;
    }
    case "session.deleted": {
      const sessionID = event.data?.sessionID;
      if (typeof sessionID !== "string") return;
      await finalizeFreePiSession(deps, sessionID);
      forgetFreePiSession(deps, sessionID);
      forgetToolStats(deps, sessionID);
      deps.state.subagentSessions.delete(sessionID);
      deps.state.lastModelBySession.delete(sessionID);
      return;
    }
    case "location.shutdown": {
      cancelAllFinalizeTimers(deps);
      await closeFreePiSession(deps).catch(() => undefined);
      return;
    }
  }
}

export async function subscribeEvents(
  ctx: Plugin.Context,
  deps: Deps,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const event of ctx.event.subscribe({
      types: EVENT_TYPES as any,
      signal: controller.signal,
    })) {
      try {
        await handleEvent(ctx, deps, event);
      } catch (error) {
        deps.log.warn("free-pi event handling failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch {
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
