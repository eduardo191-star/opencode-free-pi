/** Subscribes to core events that affect free-pi state. */

import type { Plugin } from "@opencode/plugin";
import { closeFreePiSession } from "../api/session.js";
import { readCredentialsToken } from "../auth/credentials.js";
import { tokenFromCredential } from "../auth/credential.js";
import type { Deps } from "../deps.js";
import { handleFreePiError } from "../errors/handle.js";
import { forgetCacheMiss, observeStepUsage } from "./cache.js";
import { forgetToolStats } from "./tools.js";
import {
  beginExecution,
  cancelAllFinalizeTimers,
  endExecution,
  finalizeFreePiSession,
  forgetFreePiSession,
} from "./track.js";
import { recordUsage } from "./usage.js";

const EVENT_TYPES = [
  "credential.updated",
  "credential.switched",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.usage.updated",
  "session.step.ended",
  "session.deleted",
  "location.shutdown",
] as const;

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
      await ctx.provider.reload().catch(() => undefined);
      return;
    }
    case "session.execution.started": {
      beginExecution(deps, event.data?.sessionID);
      return;
    }
    case "session.execution.failed": {
      const sessionID = event.data?.sessionID;
      await handleFreePiError(deps, event.data?.error, {
        allowRaw:
          typeof sessionID === "string" &&
          deps.state.freePiSessions.has(sessionID),
      }).catch(() => undefined);
      endExecution(deps, sessionID);
      return;
    }
    case "session.execution.succeeded":
    case "session.execution.interrupted": {
      endExecution(deps, event.data?.sessionID);
      return;
    }
    case "session.usage.updated": {
      recordUsage(
        deps,
        event.data?.sessionID,
        event.data?.cost,
        event.data?.tokens,
      );
      return;
    }
    case "session.step.ended": {
      recordUsage(
        deps,
        event.data?.sessionID,
        event.data?.cost,
        event.data?.tokens,
      );
      // Step tokens are per request; usage.updated is cumulative.
      observeStepUsage(deps, event.data?.sessionID, event.data?.tokens);
      return;
    }
    case "session.deleted": {
      const sessionID = event.data?.sessionID;
      if (typeof sessionID !== "string") return;
      await finalizeFreePiSession(deps, sessionID);
      forgetFreePiSession(deps, sessionID);
      forgetCacheMiss(deps, sessionID);
      forgetToolStats(deps, sessionID);
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
