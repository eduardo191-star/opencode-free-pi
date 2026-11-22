/**
 * Guards against a provider that reports a context overflow for a request that
 * plainly fits the model's window.
 *
 * free-pi returns `context_ceiling`/`context_too_long` when the upstream model
 * rejects a prompt as too long. The client turns that into OpenCode's
 * "prompt is too long" overflow, which is correct for a real overflow: the
 * runner compacts and retries. When the gateway is failing it can report the
 * same code for a small prompt, and then every compaction is followed by the
 * next rejection: an endless compact/retry storm that spends real credits on
 * summaries. A request far below the advertised window cannot be a window
 * overflow, so the plugin retries it on a fresh wire session and, if that
 * still fails, surfaces a provider error instead of asking for another
 * compaction.
 */

import type { Deps } from "../deps.js";

/** A request below this many tokens cannot exhaust a 200k window on its own. */
export const SPURIOUS_OVERFLOW_TOKENS = 60_000;

/** Spurious rejections closer together than this belong to the same incident. */
const STORM_WINDOW_MS = 10 * 60_000;

/** Spurious rejections tolerated in a window before the error stops compacting. */
const STORM_LIMIT = 2;

const STORM_LIMIT_PER_SESSION = 512;

export const SPURIOUS_OVERFLOW_MESSAGE =
  "free-pi rejected this request as too long even though it fits the model's window; " +
  "this is a provider failure, not a context overflow. Retry the message, or start a new session if it persists.";

/**
 * Approximate token count of a chat-completions body: every string in it,
 * message text and tool output alike, at the usual four characters per token.
 * Inline media counts at its base64 length, which is what the provider bills.
 */
export function measureRequestTokens(body: string): number {
  try {
    const data = JSON.parse(body) as unknown;
    let chars = 0;
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        chars += value.length;
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          chars += key.length;
          walk(item);
        }
      }
    };
    walk(data);
    return Math.ceil(chars / 4);
  } catch {
    return Math.ceil(body.length / 4);
  }
}

/**
 * Records a rejection of a request that fits, and returns the number of them
 * seen for the session inside the current window. A run of them means the
 * provider is failing, so compacting again cannot help.
 */
export function noteSpuriousOverflow(deps: Deps, sessionID: string): number {
  if (!sessionID) return 0;
  const now = Date.now();
  const previous = deps.state.spuriousOverflows.get(sessionID);
  const count =
    previous && now - previous.at <= STORM_WINDOW_MS ? previous.count + 1 : 1;
  deps.state.spuriousOverflows.set(sessionID, { at: now, count });
  if (deps.state.spuriousOverflows.size > STORM_LIMIT_PER_SESSION) {
    const oldest = deps.state.spuriousOverflows.keys().next().value;
    if (oldest !== undefined) deps.state.spuriousOverflows.delete(oldest);
  }
  return count;
}

export function clearSpuriousOverflows(deps: Deps, sessionID: string): void {
  deps.state.spuriousOverflows.delete(sessionID);
}

/** Whether the session has had enough spurious rejections to stop compacting. */
export function overflowingSpuriously(deps: Deps, sessionID: string): boolean {
  const entry = deps.state.spuriousOverflows.get(sessionID);
  if (!entry) return false;
  if (Date.now() - entry.at > STORM_WINDOW_MS) return false;
  return entry.count > STORM_LIMIT;
}

/**
 * Turns an overflow response into a provider error OpenCode will not classify
 * as a context overflow. The session still shows a failure, but the runner
 * stops compacting and retrying a conversation that already fits.
 */
export function spuriousOverflowResponse(original: Response): Response {
  const headers = new Headers(original.headers);
  headers.delete("retry-after");
  headers.delete("retry-after-ms");
  headers.set("x-free-pi-spurious-overflow", "1");
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({
      error: { type: "provider_error", message: SPURIOUS_OVERFLOW_MESSAGE },
      message: SPURIOUS_OVERFLOW_MESSAGE,
    }),
    { status: 400, statusText: "Bad Request", headers },
  );
}
