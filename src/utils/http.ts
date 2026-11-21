/** JSON request helpers for the free-pi HTTP API. */

import { sleep } from "./async.js";
import { resolveBaseUrl } from "./urls.js";

export async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(new URL(path, resolveBaseUrl()), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

export async function postJsonRetry(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await postJson(path, body, headers);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1_500 * attempt);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        "Can't reach free-pi. Check your internet connection and try again.",
      );
}

export function failureText(status: number, body: any): string {
  if (status === 429) {
    return "Too many sign-in attempts from your network. Wait a minute and try again.";
  }
  if (
    status >= 400 &&
    status < 500 &&
    typeof body?.message === "string" &&
    body.message.trim()
  ) {
    return body.message.trim();
  }
  if (status >= 500) {
    return `free-pi is having trouble right now (HTTP ${status}). Try again in a minute.`;
  }
  return `free-pi could not complete sign-in (HTTP ${status}). Try again in a minute.`;
}
