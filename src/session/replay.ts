/**
 * Transparently replays a free-pi request that hit the per-session
 * `429 concurrent` limit.
 *
 * OpenCode builds the provider request once and reuses it for every retry of a
 * step (`SessionRunner.runStep` calls `request.primary` outside the attempt
 * loop). Rotating `x-session-id` in the retry hook therefore cannot help the
 * failed attempt: the retried request still carries the old id. The server can
 * also leave a session slot locked after an aborted stream, which resets do not
 * clear.
 *
 * Replaying from `http.response` instead sends the same body with a fresh wire
 * session id and returns the good response to OpenCode, so the turn continues
 * without a visible "Retrying…" or a failed step.
 */

import { closeFreePiSession } from "../api/session.js";
import type { Deps } from "../deps.js";
import { overflowCodeOf } from "../errors/limit.js";
import { sleep, trimMap } from "../utils/async.js";
import {
  profileRequest,
  SPURIOUS_OVERFLOW_TOKENS,
} from "./overflow.js";
import { traceRequestBody } from "./trace.js";
import { rotateWireSessionID, wireSessionID } from "./wire.js";

const REPLAY_BODY_LIMIT = 24;
const REPLAY_MAX_ATTEMPTS = 4;
const REPLAY_BASE_DELAY_MS = 400;
const REPLAY_MAX_DELAY_MS = 3_000;

/** A rejected request that fits is retried only this many times on fresh ids. */
const OVERFLOW_REPLAY_ATTEMPTS = 2;

function requestKey(sessionID: string, request: Request): string {
  const turn = request.headers.get("x-turn-id") ?? "";
  return `${sessionID}\u0000${turn}\u0000${request.url}`;
}

function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").includes("json");
}

/** Keeps the body around so a 429 can be replayed after fetch consumed it. */
export async function rememberReplayBody(
  deps: Deps,
  event: any,
): Promise<void> {
  const request = event?.request;
  if (!(request instanceof Request) || !isJson(request) || !event.sessionID)
    return;
  const key = requestKey(event.sessionID, request);
  try {
    const body = await request.clone().text();
    if (!body) return;
    deps.state.replayBodies.delete(key);
    deps.state.replayBodies.set(key, body);
    trimMap(deps.state.replayBodies, REPLAY_BODY_LIMIT);
    traceRequestBody(deps, event.sessionID, body);
  } catch {
    // A non-replayable body simply falls back to the normal retry hook.
  }
}

async function isConcurrent(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  const body = await response
    .clone()
    .text()
    .catch(() => "");
  return /"concurrent"/i.test(body) || /one request at a time/i.test(body);
}

/** The request body, either remembered before the send or re-read from it. */
async function storedBody(deps: Deps, event: any): Promise<string | undefined> {
  const request = event?.request;
  if (!(request instanceof Request) || !event.sessionID) return;
  const remembered = deps.state.replayBodies.get(
    requestKey(event.sessionID, request),
  );
  if (remembered !== undefined) return remembered;
  if (!isJson(request)) return;
  return request
    .clone()
    .text()
    .catch(() => undefined);
}

function concurrentDelay(attempt: number): number {
  return Math.min(
    REPLAY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    REPLAY_MAX_DELAY_MS,
  );
}

/**
 * Returns a replacement response when a concurrent 429 was recovered, or
 * `undefined` to leave the original response untouched.
 */
export async function replayConcurrentResponse(
  deps: Deps,
  event: any,
): Promise<Response | undefined> {
  const original = event?.response;
  const request = event?.request;
  if (!(original instanceof Response) || !(request instanceof Request)) return;
  if (request.signal.aborted) return;
  if (!(await isConcurrent(original))) return;

  const body = await storedBody(deps, event);
  if (!body) {
    deps.log.warn(
      "free-pi session busy but the request body was not available to replay",
      { sessionID: event.sessionID },
    );
    return;
  }

  let previous =
    request.headers.get("x-session-id") ??
    wireSessionID(deps, event.sessionID);

  for (let attempt = 1; attempt <= REPLAY_MAX_ATTEMPTS; attempt++) {
    if (request.signal.aborted) return;
    if (attempt > 1) await sleep(concurrentDelay(attempt));
    const next = rotateWireSessionID(deps, event.sessionID);
    if (previous && previous !== next) {
      void closeFreePiSession(deps, previous).catch(() => undefined);
    }
    previous = next;

    const headers = new Headers(request.headers);
    headers.set("x-session-id", next);
    headers.delete("content-length");
    headers.delete("host");

    const response = await fetch(request.url, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    }).catch(() => undefined);
    if (!response) continue;
    if (!(await isConcurrent(response))) {
      deps.log.info(
        "free-pi session busy; replayed the request with a fresh session id",
        {
          sessionID: event.sessionID,
          from: request.headers.get("x-session-id") ?? undefined,
          to: next,
          attempt,
        },
      );
      return response;
    }
  }
  return undefined;
}

export type OverflowReplay = {
  /** Tokens of the rejected request, when its body was available. */
  readonly tokens?: number;
  /** Upstream model the rejected request asked for. */
  readonly model?: string;
  /** Whether the rejected request carried an inline image or file. */
  readonly hasMedia?: boolean;
  /** Whether the rejected request plainly fits the model window. */
  readonly spurious?: boolean;
  /** A good response from a fresh wire session, when the retry succeeded. */
  readonly response?: Response;
};

/**
 * Retries an overflow rejection whose request plainly fits the model window.
 *
 * free-pi reports `context_ceiling`/`context_too_long` from the upstream
 * model, and a failing gateway can report them for a small prompt. Compacting
 * cannot fix that: the summary is accepted, the next turn is rejected the same
 * way, and the runner compacts again. A fresh wire session is the cheapest
 * recovery, so a small request is replayed on one before the overflow is
 * handed to the runner.
 */
export async function replaySpuriousOverflow(
  deps: Deps,
  event: any,
): Promise<OverflowReplay> {
  const original = event?.response;
  const request = event?.request;
  if (!(original instanceof Response) || !(request instanceof Request)) return {};
  if (request.signal.aborted) return {};
  if (!(await overflowCodeOf(original))) return {};

  const body = await storedBody(deps, event);
  if (!body) return {};
  const profile = profileRequest(body);
  const tokens = profile.tokens;
  const facts = { model: profile.model, hasMedia: profile.hasMedia };
  if (tokens >= SPURIOUS_OVERFLOW_TOKENS) {
    return { tokens, ...facts, spurious: false };
  }

  let previous =
    request.headers.get("x-session-id") ?? wireSessionID(deps, event.sessionID);
  for (let attempt = 1; attempt <= OVERFLOW_REPLAY_ATTEMPTS; attempt++) {
    if (request.signal.aborted) return { tokens, ...facts, spurious: true };
    const next = rotateWireSessionID(deps, event.sessionID);
    if (previous && previous !== next) {
      void closeFreePiSession(deps, previous).catch(() => undefined);
    }
    previous = next;

    const headers = new Headers(request.headers);
    headers.set("x-session-id", next);
    headers.delete("content-length");
    headers.delete("host");

    const response = await fetch(request.url, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    }).catch(() => undefined);
    if (!response) continue;
    if (!(await overflowCodeOf(response))) {
      deps.log.info(
        "free-pi rejected a request that fits as too long; replayed it on a fresh session id",
        { sessionID: event.sessionID, tokens, to: next, attempt },
      );
      return { tokens, ...facts, spurious: true, response };
    }
  }
  deps.log.info(
    "free-pi keeps rejecting a request that fits as too long; the provider is failing",
    { sessionID: event.sessionID, tokens },
  );
  return { tokens, ...facts, spurious: true };
}
