/**
 * Live limits and capabilities.
 *
 * free-pi's HTTP API never publishes per-model limits: `/client-version` only
 * carries id/name/free/section/note/stats_id, `/me` carries the quota, and chat
 * responses carry usage but no window. The gateway does enforce a real ceiling,
 * so the plugin verifies the advertised window against the gateway itself and
 * remembers what it learned. The measured value replaces the compiled default
 * on the next start; a probe failure leaves the previous value untouched.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveToken } from "../auth/token.js";
import {
  CONTEXT_WINDOW,
  VERIFY_LIMITS_TTL_MS,
} from "../constants.js";
import type { Deps } from "../deps.js";
import type { TokenUsageLike } from "../types.js";
import { dataPath } from "../utils/data-dir.js";
import { completionsBaseUrl } from "../utils/urls.js";

const FILE = "live-limits.json";
const WRITE_DEBOUNCE_MS = 2_000;
/** Verification stops shrinking here instead of advertising a useless window. */
const MIN_WINDOW = 32_768;
/** Hard stop for the upward search; `buildModels` never advertises more. */
const MAX_WINDOW = 1_000_000;
/** Keep headroom under the exact ceiling so a fresh turn never hits a 413. */
const WINDOW_SAFETY = 0.97;
/** Probe requests per verification, counting the initial confirmation. */
const MAX_PROBES = 6;
/** OpenCode budgets four characters per token; correct it after the first probe. */
const INITIAL_CHARS_PER_TOKEN = 4;

export type ModelObservation = {
  /** Largest prompt the gateway accepted for this model. */
  maxPromptTokens?: number;
  /** Whether a real response carried reasoning tokens. */
  reasoning?: boolean;
  updatedAt: number;
};

export type LiveLimits = {
  version: 1;
  /** Window verified against the gateway, used for the next catalog build. */
  window?: { tokens: number; verifiedAt: number; model?: string };
  /** What real traffic showed for each model. */
  models: Record<string, ModelObservation>;
};

let cached: LiveLimits | undefined;
let loaded = false;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

function emptyLimits(): LiveLimits {
  return { version: 1, models: {} };
}

function sanitize(value: unknown): LiveLimits {
  if (!value || typeof value !== "object") return emptyLimits();
  const limits = value as Partial<LiveLimits>;
  const models: Record<string, ModelObservation> = {};
  for (const [id, entry] of Object.entries(limits.models ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const observation: ModelObservation = {
      updatedAt:
        typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
    };
    if (Number.isFinite(entry.maxPromptTokens) && entry.maxPromptTokens! > 0) {
      observation.maxPromptTokens = Math.floor(entry.maxPromptTokens!);
    }
    if (typeof entry.reasoning === "boolean") {
      observation.reasoning = entry.reasoning;
    }
    models[id] = observation;
  }
  const window = limits.window;
  return {
    version: 1,
    models,
    ...(window &&
    Number.isFinite(window.tokens) &&
    window.tokens > 0 &&
    Number.isFinite(window.verifiedAt)
      ? {
          window: {
            tokens: Math.floor(window.tokens),
            verifiedAt: window.verifiedAt,
            ...(typeof window.model === "string" ? { model: window.model } : {}),
          },
        }
      : {}),
  };
}

/** Reads the persisted measurements once per process. Never throws. */
export async function loadLiveLimits(): Promise<LiveLimits> {
  if (loaded && cached) return cached;
  try {
    cached = sanitize(JSON.parse(await readFile(dataPath(FILE), "utf8")));
  } catch {
    cached = emptyLimits();
  }
  loaded = true;
  return cached;
}

/** The measurements loaded for this process. */
export function currentLiveLimits(): LiveLimits | undefined {
  return cached;
}

async function persist(): Promise<void> {
  if (!cached) return;
  try {
    const file = dataPath(FILE);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(cached), "utf8");
  } catch {
    // Measurements are an optimization; failing to persist changes nothing.
  }
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    void persist();
  }, WRITE_DEBOUNCE_MS);
  writeTimer.unref?.();
}

function observation(modelID: string): ModelObservation {
  const limits = (cached ??= emptyLimits());
  limits.models[modelID] ??= { updatedAt: Date.now() };
  return limits.models[modelID]!;
}

/**
 * Folds a real step's usage into the model's record: the prompt size proves the
 * gateway accepted at least that much context, and reasoning tokens prove the
 * model really reasoned for this account.
 */
export function noteStepTokens(
  _deps: Deps,
  modelID: string,
  tokens: TokenUsageLike | undefined,
): void {
  if (!modelID || !tokens) return;
  const prompt =
    (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
  const entry = observation(modelID);
  let changed = false;
  if (prompt > 0 && prompt >= (entry.maxPromptTokens ?? 0)) {
    entry.maxPromptTokens = Math.floor(prompt);
    changed = true;
  }
  if ((tokens.reasoning ?? 0) > 0 && entry.reasoning !== true) {
    entry.reasoning = true;
    changed = true;
  }
  if (!changed) return;
  entry.updatedAt = Date.now();
  scheduleWrite();
}

/** Whether the persisted window is old enough to verify again. */
export function shouldVerifyWindow(limits: LiveLimits | undefined): boolean {
  const verifiedAt = limits?.window?.verifiedAt;
  if (!verifiedAt) return true;
  return Date.now() - verifiedAt > VERIFY_LIMITS_TTL_MS;
}

function filler(chars: number): string {
  const unit =
    "the quick brown fox jumps over the lazy dog while maintainers review the patch and debate naming ";
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}

type ProbeResult =
  | { status: "ok"; promptTokens?: number }
  | { status: "too_long" }
  | { status: "failed" };

async function sendProbe(
  deps: Deps,
  modelID: string,
  chars: number,
): Promise<ProbeResult> {
  const token = await resolveToken(deps).catch(() => undefined);
  if (!token) return { status: "failed" };
  const content = `${filler(chars)}\n\nIgnore the filler and reply with OK.`;
  let response: Response;
  try {
    response = await fetch(`${completionsBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-client-version": deps.state.latestClientVersion,
        "x-session-id": `free-pi-window-${Date.now().toString(36)}`,
        "x-ad-context": "none",
      },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content }],
        stream: false,
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    return { status: "failed" };
  }
  if (response.status === 413 || response.status === 400) {
    const body = await response.text().catch(() => "");
    if (/context_too_long|too long|context_ceiling/i.test(body)) {
      return { status: "too_long" };
    }
    return { status: "failed" };
  }
  if (!response.ok) return { status: "failed" };
  const payload = (await response.json().catch(() => undefined)) as
    | { usage?: { prompt_tokens?: number } }
    | undefined;
  const promptTokens = payload?.usage?.prompt_tokens;
  return {
    status: "ok",
    ...(typeof promptTokens === "number" ? { promptTokens } : {}),
  };
}

export type VerifyLimitsOptions = {
  /** A free model to probe with; paid models would spend credits. */
  model?: string;
  /** Window to check. Defaults to the measured one, then the compiled one. */
  window?: number;
};

/** One gateway answer used to settle the advertised window. */
export type ProbeSample = {
  chars: number;
  /** Prompt tokens the gateway reported for an accepted probe. */
  tokens?: number;
  tooLong: boolean;
};

/**
 * Largest window the accepted probes prove, with headroom. Pure so the probe
 * loop and the persisted value can be tested without a server.
 */
export function settleWindow(
  samples: readonly ProbeSample[],
): number | undefined {
  let best = 0;
  for (const sample of samples) {
    if (sample.tooLong) continue;
    if (!Number.isFinite(sample.tokens) || (sample.tokens ?? 0) <= 0) continue;
    if (sample.tokens! <= best) continue;
    best = sample.tokens!;
  }
  if (best === 0) return undefined;
  return Math.min(
    MAX_WINDOW,
    Math.max(MIN_WINDOW, Math.floor((best * WINDOW_SAFETY) / 1_000) * 1_000),
  );
}

/**
 * Checks the compiled window against the gateway and then grows past it while
 * the gateway keeps accepting larger prompts. The start value is a floor, not a
 * ceiling: the server has no endpoint for its real limit, and pinning sessions
 * to the CLI's 200k wastes capacity the account can actually use. On rejection
 * it binary-searches between the largest accepted prompt and the rejected one,
 * so the next catalog build advertises the measured window. Returns the verified
 * window, or `undefined` when nothing could be learned (the previous value is
 * kept).
 */
export async function verifyGatewayWindow(
  deps: Deps,
  options: VerifyLimitsOptions = {},
): Promise<number | undefined> {
  const modelID = options.model;
  if (!modelID) return undefined;
  const fallback =
    options.window ?? cached?.window?.tokens ?? CONTEXT_WINDOW;
  const samples: ProbeSample[] = [];
  // Accepted prompt tokens; also the lower bound of the binary search.
  let accepted = 0;
  let charsPerToken = INITIAL_CHARS_PER_TOKEN;
  let target = Math.max(MIN_WINDOW, Math.min(fallback, MAX_WINDOW));

  for (let attempt = 0; attempt < MAX_PROBES; attempt += 1) {
    const chars = Math.max(
      MIN_WINDOW * charsPerToken,
      Math.floor(target * charsPerToken * 0.99),
    );
    const result = await sendProbe(deps, modelID, chars);
    if (result.status === "failed") {
      // A network failure or a rejected body proves nothing; keep what the
      // earlier probes already established.
      if (samples.length === 0) return undefined;
      break;
    }
    if (result.status === "too_long") {
      samples.push({ chars, tooLong: true });
      if (accepted === 0) {
        // The compiled window itself is too large: step down as before.
        target = Math.floor(target * 0.85);
        if (target < MIN_WINDOW) return undefined;
        continue;
      }
      const next = Math.floor((accepted + target) / 2);
      if (next <= accepted) break;
      target = next;
      continue;
    }

    const tokens = result.promptTokens;
    samples.push({
      chars,
      tooLong: false,
      ...(tokens && tokens > 0 ? { tokens } : {}),
    });
    if (tokens && tokens > 0) {
      accepted = tokens;
      // Learn the real characters-per-token ratio for this prompt shape; the
      // filler is prose, and four chars/token overshoots badly.
      charsPerToken = chars / tokens;
    } else {
      accepted = Math.floor(chars / charsPerToken);
    }
    if (accepted >= MAX_WINDOW) break;
    const next = Math.min(MAX_WINDOW, Math.floor(accepted * 1.2));
    if (next <= accepted) break;
    target = next;
  }

  const settled = settleWindow(samples);
  if (!settled) return undefined;
  // Keep the previous floor when growth probes only prove less: the CLI's 200k
  // is already known to work, so a small upstream probe model must not shrink
  // every session's window.
  const verified = Math.max(settled, Math.min(fallback, CONTEXT_WINDOW));
  const limits = (cached ??= emptyLimits());
  limits.window = { tokens: verified, verifiedAt: Date.now(), model: modelID };
  loaded = true;
  await persist();
  deps.log.info("free-pi verified the gateway context window", {
    model: modelID,
    window: verified,
    compiled: fallback,
    probes: samples.length,
    acceptedTokens: accepted,
    charsPerToken: Number(charsPerToken.toFixed(2)),
  });
  return verified;
}
