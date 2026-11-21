/** Extracts a structured free-pi error from provider or session errors. */

import type { FreePiError } from "../types.js";

const RAW_FREE_PI_ERROR_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(?:econnreset|econnrefused|eai_again|eproto|enotfound|etimedout)\b|socket connection was closed|cannot connect to api|unable to connect|tls handshake failed|fetch failed|connection (?:error|reset|closed)/i,
    "network_error",
  ],
  [/request timed out|timed out|timeout/i, "timeout"],
  [
    /already got \d+ free-pi cli sessions|free-pi cli sessions running|session limit|concurrent_session/i,
    "concurrent_session",
  ],
  [
    /\bads\b.*\b(?:pay|showing|paused|skipped)\b|free-pi is free because ads/i,
    "ads_required",
  ],
  [
    /model needs (?:premium|purchased) credits|needs premium credits|model_requires_credits/i,
    "model_requires_credits",
  ],
  [
    /premium allowance (?:used up|exhausted)|premium_allowance/i,
    "premium_allowance",
  ],
  [
    /insufficient credits|not enough credits|insufficient_credits/i,
    "insufficient_credits",
  ],
  [/guest trial used up|guest_allowance/i, "guest_allowance"],
  [
    /free usage limit|monthly usage limit/i,
    "free_usage_limit",
  ],
  [
    /needs a github sign-in|sign in with github|guest_login_required/i,
    "guest_login_required",
  ],
  [/not available in your region|region_unavailable/i, "region_unavailable"],
  [/account is under review|account_review/i, "account_review"],
  [/consent required|consent_required/i, "consent_required"],
  [
    /(?:client|cli|version).*(?:out of date|upgrade)|upgrade required|upgrade_required/i,
    "upgrade_required",
  ],
  [
    /content filter|blocked by a content filter|content_filter/i,
    "content_filter",
  ],
  [
    /subagents? (?:need|run)|subagents unavailable|subagents_unavailable/i,
    "subagents_unavailable",
  ],
  [/reward holders?|reward_required/i, "reward_required"],
  [
    /model (?:is )?busy|model at capacity|at capacity|model_at_capacity/i,
    "model_at_capacity",
  ],
  [
    /(?:conversation|context).*(?:too long|too large)|maximum context|context (?:window|length)|context_ceiling|context_too_long/i,
    "context_too_long",
  ],
  [
    /out of free credits|daily (?:free )?(?:credits|limit)|free allowance (?:is )?(?:used up|exhausted)|allowance used up|daily_cap/i,
    "daily_cap",
  ],
  [/rate.?limit|too many requests|rate_limited/i, "rate_limited"],
  [
    /upstream .*error|provider is failing|upstream returned an error|upstream_error/i,
    "upstream_error",
  ],
  [
    /sign-in (?:is )?(?:invalid|expired)|invalid or expired|unauthorized|expired token|expired_token/i,
    "unauthorized",
  ],
];

function statusOf(error: any): number | undefined {
  if (typeof error?.status === "number") return error.status;
  if (typeof error?.data?.statusCode === "number") return error.data.statusCode;
  if (typeof error?.statusCode === "number") return error.statusCode;
  return undefined;
}

export function parseRawFreePiError(error: any): FreePiError | undefined {
  const raw = error?.data?.message ?? error?.message;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const text = raw.trim();
  if (/^\d{3}: \{/.test(text)) return undefined;
  const status = statusOf(error);
  for (const [pattern, code] of RAW_FREE_PI_ERROR_PATTERNS) {
    if (pattern.test(text)) return { status, code, message: text };
  }
  return undefined;
}

/**
 * Recovers a code from the server's message text when the envelope carries no
 * `code` field, for example the free-usage-limit 429 that only sends a message.
 */
function codeFromText(message: unknown): string | undefined {
  if (typeof message !== "string" || !message.trim()) return undefined;
  const text = message.trim();
  for (const [pattern, code] of RAW_FREE_PI_ERROR_PATTERNS) {
    if (pattern.test(text)) return code;
  }
  return undefined;
}

export function parseFreePiError(
  error: any,
  allowRaw = false,
): FreePiError | undefined {
  const candidates = [
    error?.response?.body,
    error?.data?.responseBody,
    error?.responseBody,
    error?.data,
    error?.data?.message,
    error?.message,
  ];
  for (const raw of candidates) {
    let status = statusOf(error);
    let body: any;
    if (raw && typeof raw === "object") {
      body = raw;
    } else if (typeof raw === "string") {
      const text = raw.trim();
      try {
        body = JSON.parse(text);
      } catch {
        const match = /^(\d{3}): (\{[\s\S]*\})\s*$/.exec(text);
        if (match) {
          status = Number(match[1]);
          try {
            body = JSON.parse(match[2]);
          } catch {}
        }
      }
    }
    if (!body || typeof body !== "object") continue;
    const codeValue = body.code ?? body.error?.code;
    const message = body.message ?? body.error?.message;
    const code =
      typeof codeValue === "string"
        ? codeValue
        : status === 401
          ? "unauthorized"
          : codeFromText(message);
    if (!code && typeof message !== "string") continue;
    return {
      status: typeof body.status === "number" ? body.status : status,
      code: code ?? "unknown",
      message: typeof message === "string" ? message : undefined,
      limit: typeof body.limit === "string" ? body.limit : undefined,
      retry_after_seconds:
        typeof body.retry_after_seconds === "number"
          ? body.retry_after_seconds
          : undefined,
      clears_at:
        typeof body.clears_at === "string" ? body.clears_at : undefined,
      remaining_credits_today:
        typeof body.remaining_credits_today === "number"
          ? body.remaining_credits_today
          : undefined,
      allowance_credits:
        typeof body.allowance_credits === "number"
          ? body.allowance_credits
          : undefined,
    };
  }
  return allowRaw ? parseRawFreePiError(error) : undefined;
}
