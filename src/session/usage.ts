/** Tracks the last request's model and token usage and refreshes quota. */

import { fetchQuota } from "../api/quota.js";
import { QUOTA_REFRESH_DEBOUNCE_MS } from "../constants.js";
import type { Deps } from "../deps.js";
import type { TokenUsageLike } from "../types.js";
import { trimMap } from "../utils/async.js";
import { touchSessionActivity } from "./track.js";

export function rememberTrackedModel(
  deps: Deps,
  sessionID: string,
  providerID: string,
  modelID: string,
): void {
  trimMap(deps.state.trackedModels, 200);
  deps.state.trackedModels.set(sessionID, { providerID, modelID });
}

export function recordUsage(
  deps: Deps,
  sessionID: string,
  cost: number,
  tokens: TokenUsageLike | undefined,
): void {
  if (typeof sessionID !== "string" || !sessionID) return;
  touchSessionActivity(deps, sessionID);
  const tracked = deps.state.trackedModels.get(sessionID);
  deps.state.lastUsage = {
    at: Date.now(),
    messageID: "",
    providerID: tracked?.providerID ?? "",
    modelID: tracked?.modelID ?? "",
    cost: typeof cost === "number" ? cost : 0,
    input: tokens?.input ?? 0,
    output: tokens?.output ?? 0,
    reasoning: tokens?.reasoning ?? 0,
    cacheRead: tokens?.cache?.read ?? 0,
    cacheWrite: tokens?.cache?.write ?? 0,
  };

  const now = Date.now();
  if (now - deps.state.lastQuotaRefreshAt < QUOTA_REFRESH_DEBOUNCE_MS) return;
  deps.state.lastQuotaRefreshAt = now;
  void fetchQuota(deps, { force: true }).catch(() => undefined);
}
