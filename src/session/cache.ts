/**
 * Prompt-cache miss notices, mirroring pi's `cache-stats` detector.
 *
 * free-pi reports no per-token cost, so only the token threshold applies. The
 * notices are opt-in because OpenCode has no toast surface for them.
 */

import {
  CACHE_MISS_NOISE_FLOOR_TOKENS,
  CACHE_MISS_NOTICE_TOKENS,
  CACHE_TTL_MS,
  DEFENSE_PROVIDER_ID,
  PROVIDER_ID,
} from "../constants.js";
import type { Deps } from "../deps.js";
import type { TokenUsageLike } from "../types.js";

function noticesEnabled(): boolean {
  const value = process.env.FREE_PI_CACHE_MISS_NOTICES?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function idleText(idleMs: number): string {
  const minutes = Math.round(idleMs / 60_000);
  return idleMs > CACHE_TTL_MS ? ` after ${minutes}m idle` : "";
}

/**
 * Records one step's usage and logs a miss when the prompt was re-billed.
 * `session.step.ended` carries per-step tokens; `session.usage.updated` is a
 * cumulative total and must not be fed here.
 */
export function observeStepUsage(
  deps: Deps,
  sessionID: string | undefined,
  tokens: TokenUsageLike | undefined,
): void {
  if (!noticesEnabled() || typeof sessionID !== "string" || !sessionID) return;
  const tracked = deps.state.trackedModels.get(sessionID);
  if (
    tracked?.providerID !== PROVIDER_ID &&
    tracked?.providerID !== DEFENSE_PROVIDER_ID
  )
    return;

  const cacheRead = tokens?.cache?.read ?? 0;
  const cacheWrite = tokens?.cache?.write ?? 0;
  const promptTokens = (tokens?.input ?? 0) + cacheRead + cacheWrite;
  if (promptTokens <= 0) return;

  const now = Date.now();
  const modelKey = `${tracked.providerID}/${tracked.modelID}`;
  const previous = deps.state.cacheMisses.get(sessionID);
  if (previous) {
    const reportedCache =
      previous.reportedCache || cacheRead + cacheWrite > 0;
    if (reportedCache) {
      const missedTokens =
        Math.min(previous.promptTokens, promptTokens) - cacheRead;
      if (missedTokens > CACHE_MISS_NOISE_FLOOR_TOKENS) {
        const modelChanged = previous.modelKey !== modelKey;
        if (missedTokens >= CACHE_MISS_NOTICE_TOKENS) {
          deps.log.info(
            `cache miss: ${missedTokens} tokens re-billed${idleText(now - previous.at)}${modelChanged ? " (model changed)" : ""}`,
            { sessionID, model: modelKey },
          );
        }
      }
    }
  }

  deps.state.cacheMisses.set(sessionID, {
    promptTokens,
    at: now,
    modelKey,
    reportedCache: cacheRead + cacheWrite > 0 || (previous?.reportedCache ?? false),
  });
}

export function forgetCacheMiss(deps: Deps, sessionID: string): void {
  deps.state.cacheMisses.delete(sessionID);
}
