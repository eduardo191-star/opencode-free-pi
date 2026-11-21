/**
 * `free_pi_usage`, the free-pi allowance tool.
 *
 * Mirrors the provider CLI: `GET /me/stats` and a compact, human-readable
 * summary. Read-only and gated to free-pi sessions.
 */

import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
import {
  done,
  fail,
  freePiRequest,
  friendlyStatus,
  GATED_TEXT,
  isGatedSession,
} from "./api.js";

const NO_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

const NO_ARGUMENTS = "free_pi_usage takes no arguments.";

const SLOW_LANE_NOTICE =
  "You're out of free credits for today. You can keep working on our spare capacity while it lasts, or buy credits to keep going at full speed.";

const number = (value: number) => value.toLocaleString("en-US");

function formatRefillEt(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${formatted} ET`;
}

function percentUsed(spentUsd: number, capUsd: number): number {
  if (!(capUsd > 0)) return 100;
  return Math.min(100, Math.max(0, Math.round((spentUsd / capUsd) * 100)));
}

function creditsLeftLine(
  remaining: number,
  allowance: number,
  refillAt: Date,
): string {
  return `${number(remaining)} / ${number(allowance)} credits left today - refills ${formatRefillEt(refillAt)}`;
}

export function formatUsage(stats: any): string {
  const t = stats ?? {};
  const remaining = t.remaining_credits_today;
  const allowance = t.allowance_credits;
  const refillAt = t.refill_at;
  const tiered =
    t.credit_tiers === true &&
    typeof t.premium_credits === "number" &&
    typeof remaining === "number" &&
    typeof allowance === "number" &&
    typeof refillAt === "string";

  const todayLine =
    typeof remaining === "number" &&
    typeof allowance === "number" &&
    typeof refillAt === "string"
      ? creditsLeftLine(remaining, allowance, new Date(refillAt))
      : `today: ${percentUsed(t.spent_usd_today ?? 0, t.cap_usd_today ?? 0)}% of your free daily allowance used`;

  const tieredLines = tiered
    ? [
        creditsLeftLine(remaining, allowance, new Date(refillAt)),
        `premium credits: ${number(t.premium_credits)} (bought ${number(t.premium_bought_credits ?? 0)} - gifted ${number(t.premium_gifted_credits ?? 0)})`,
        ...(typeof t.regular_wallet_credits === "number" &&
        t.regular_wallet_credits > 0
          ? [`referral credits: ${number(t.regular_wallet_credits)}`]
          : []),
        `Premium credits do not reset.${t.premium_get_line ? ` ${t.premium_get_line}` : ""}`,
      ]
    : [];

  return [
    `tier: ${t.tier ?? "unknown"}`,
    ...(tiered ? [tieredLines[0]!] : [todayLine]),
    ...(t.lane === "fallback" ? [SLOW_LANE_NOTICE] : []),
    ...(tiered
      ? tieredLines.slice(1)
      : [
          ...(typeof t.credit_credits === "number"
            ? [`credit: ${number(t.credit_credits)} credits remaining`]
            : []),
          ...(typeof t.bonus_wallet_credits === "number" &&
          t.bonus_wallet_credits > 0
            ? [`bonus: ${number(t.bonus_wallet_credits)} credits remaining`]
            : []),
        ]),
    ...(typeof t.streak?.message === "string" && t.streak.message
      ? [t.streak.message]
      : []),
    `today tokens: ${t.prompt_tokens_today ?? 0} prompt / ${t.completion_tokens_today ?? 0} completion`,
    `lifetime: ${t.lifetime?.prompt_tokens ?? 0} prompt / ${t.lifetime?.completion_tokens ?? 0} completion tokens`,
    ...(t.guest
      ? [
          "guest trial: sign in with GitHub for up to 15,000 free credits a day",
        ]
      : []),
    "see details at freepi.ai/dashboard",
  ].join("\n");
}

async function executeUsage(
  deps: Deps,
  raw: unknown,
  context: { readonly sessionID: string; readonly signal: AbortSignal },
) {
  if (raw && typeof raw === "object" && Object.keys(raw as object).length > 0) {
    return fail(NO_ARGUMENTS);
  }
  if (!isGatedSession(deps, context.sessionID)) return fail(GATED_TEXT);

  const result = await freePiRequest(deps, {
    path: "/me/stats",
    timeoutMs: 5_000,
    signal: context.signal,
    audience: "user",
  });
  if (!result.ok) return fail(result.text);

  const stats = result.data;
  deps.log.info("free_pi_usage answered", {
    tier: stats?.tier,
    lane: stats?.lane,
  });
  return done(formatUsage(stats), {
    ok: true,
    tier: stats?.tier,
    lane: stats?.lane,
    remaining_credits_today: stats?.remaining_credits_today,
    allowance_credits: stats?.allowance_credits,
  });
}

export async function registerUsageTool(
  ctx: Plugin.Context,
  deps: Deps,
): Promise<{ dispose: () => Promise<void> }> {
  return ctx.tool.transform((editor) => {
    editor.add({
      name: "free_pi_usage",
      description:
        "Report how much of the caller's free daily allowance is used, remaining credits, token counts and account tier. Read-only, takes no arguments, makes no changes.",
      input: NO_INPUT,
      options: { codemode: false },
      execute: (input: unknown, context: any) =>
        executeUsage(deps, input, context),
    } as any);
  });
}
