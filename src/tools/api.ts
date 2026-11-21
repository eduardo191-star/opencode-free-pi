/**
 * Shared plumbing for the free-pi server tools.
 *
 * The provider CLI spends the user's daily allowance through a small set of
 * `/tools/*` and `/me*` endpoints. This module keeps the token handling,
 * timeouts and error wording identical across those tools.
 */

import { resolveToken } from "../auth/token.js";
import type { Deps } from "../deps.js";
import { isFreePiSession } from "../session/tools.js";
import { resolveBaseUrl } from "../utils/urls.js";

export type ToolOutput = {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly metadata: Record<string, unknown>;
};

export function done(
  text: string,
  metadata: Record<string, unknown> = {},
): ToolOutput {
  return { content: [{ type: "text", text }], metadata };
}

export function fail(text: string): ToolOutput {
  return done(text, { ok: false });
}

export const GATED_TEXT =
  "This tool is only available in free-pi sessions.";

/** Same wording as the provider CLI when the integration is not connected. */
export const NO_TOKEN_TEXT =
  "This tool needs a free-pi sign-in. Do not retry; tell the user to connect the free-pi integration, and continue without this tool.";

export function isGatedSession(
  deps: Deps,
  sessionID: string | undefined,
): boolean {
  return typeof sessionID === "string" && isFreePiSession(deps, sessionID);
}

export function friendlyThrown(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") return "free-pi took too long to answer. Try again.";
  if (name === "AbortError") return "Cancelled.";
  if (name === "SyntaxError") return "free-pi sent an unexpected reply. Try again.";
  return "Couldn't reach free-pi - check your connection.";
}

export function friendlyStatus(
  status: number,
  message?: unknown,
  audience: "model" | "user" = "model",
): string {
  if (status === 401) {
    return audience === "model"
      ? "The user's free-pi sign-in has expired; tell them to reconnect the free-pi integration."
      : "Your free-pi sign-in has expired. Reconnect the free-pi integration.";
  }
  if (typeof message === "string" && message.trim()) return message.trim();
  if (status >= 500) {
    return `free-pi is having trouble right now (HTTP ${status}). Try again in a minute.`;
  }
  return `free-pi could not complete the request (HTTP ${status}).`;
}

export type ApiResult =
  | { readonly ok: true; readonly data: any }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly text: string;
    };

type RequestOptions = {
  readonly path: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Passed to `friendlyStatus` for non-mapped HTTP failures. */
  readonly audience?: "model" | "user";
  /** Prefix for timeout and transport errors, e.g. "The vision request". */
  readonly label?: string;
};

/**
 * Calls a free-pi endpoint with the current credential and never throws.
 * Business error codes are returned intact so each tool can map them to the
 * exact wording the provider CLI uses.
 */
export async function freePiRequest(
  deps: Deps,
  options: RequestOptions,
): Promise<ApiResult> {
  const token = await resolveToken(deps);
  if (!token) {
    return { ok: false, status: 401, code: "no_token", text: NO_TOKEN_TEXT };
  }

  const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(`${resolveBaseUrl()}${options.path}`, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      return { ok: false, status: 0, code: "cancelled", text: "Cancelled." };
    }
    const timedOut =
      error instanceof Error && error.name === "TimeoutError";
    const prefix = options.label ? `${options.label} ` : "";
    return {
      ok: false,
      status: 0,
      code: timedOut ? "timeout" : "network",
      text: timedOut
        ? `${prefix}timed out. Try again.`
        : friendlyThrown(error),
    };
  }

  if (response.ok) {
    const data = await response.json().catch(() => undefined);
    if (data === undefined) {
      return {
        ok: false,
        status: response.status,
        code: "invalid_response",
        text: "free-pi sent an unexpected reply. Try again.",
      };
    }
    return { ok: true, data };
  }

  const body = (await response.json().catch(() => ({}))) as any;
  const code = String(body?.error?.code ?? body?.code ?? "");
  return {
    ok: false,
    status: response.status,
    code,
    text: friendlyStatus(
      response.status,
      body?.error?.message ?? body?.message,
      options.audience,
    ),
  };
}

/** Maps a business error code to the CLI's wording, or keeps the HTTP text. */
export function mappedText(
  table: Record<string, string>,
  result: Extract<ApiResult, { ok: false }>,
  library?: string,
): string {
  if (result.code === "no_token") return NO_TOKEN_TEXT;
  const mapped = table[result.code];
  if (mapped) return mapped;
  return result.text;
}
