/**
 * `free_pi_usage`, the free-pi allowance tool.
 *
 * Mirrors the provider CLI: `GET /me/stats` and a compact, human-readable
 * summary. Read-only and gated to free-pi sessions.
 */
import { done, fail, freePiRequest, GATED_TEXT, isGatedSession, } from "./api.js";
const NO_INPUT = {
    type: "object",
    additionalProperties: false,
    properties: {},
};
const NO_ARGUMENTS = "free_pi_usage takes no arguments.";
const SLOW_LANE_NOTICE = "You're out of free credits for today. You can keep working on our spare capacity while it lasts, or buy credits to keep going at full speed.";
const number = (value) => value.toLocaleString("en-US");
function formatRefillEt(date) {
    const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }).format(date);
    return `${formatted} ET`;
}
function percentUsed(spentUsd, capUsd) {
    if (!(capUsd > 0))
        return 100;
    return Math.min(100, Math.max(0, Math.round((spentUsd / capUsd) * 100)));
}
function creditsLeftLine(remaining, allowance, refillAt) {
    return `${number(remaining)} / ${number(allowance)} credits left today - refills ${formatRefillEt(refillAt)}`;
}
export function formatUsage(stats) {
    const t = stats ?? {};
    const remaining = t.remaining_credits_today;
    const allowance = t.allowance_credits;
    const refillAt = t.refill_at;
    const tiered = t.credit_tiers === true &&
        typeof t.premium_credits === "number" &&
        typeof remaining === "number" &&
        typeof allowance === "number" &&
        typeof refillAt === "string";
    const todayLine = typeof remaining === "number" &&
        typeof allowance === "number" &&
        typeof refillAt === "string"
        ? creditsLeftLine(remaining, allowance, new Date(refillAt))
        : `today: ${percentUsed(t.spent_usd_today ?? 0, t.cap_usd_today ?? 0)}% of your free daily allowance used`;
    const hasCredits = typeof remaining === "number" &&
        typeof allowance === "number" &&
        allowance > 0;
    const low = hasCredits && remaining > 0 && remaining <= allowance * 0.1;
    const empty = hasCredits && remaining <= 0;
    const buyUrl = typeof t.buy_url === "string" && t.buy_url ? t.buy_url : undefined;
    const creditLines = [
        ...(low
            ? [
                `low credits: ${Math.round((remaining / allowance) * 100)}% of today's allowance left`,
            ]
            : []),
        ...(empty
            ? [
                "Out of free credits today; they refill at the reset time, or add credits to keep going now.",
            ]
            : []),
        ...(buyUrl && (low || empty) ? [`Buy credits: ${buyUrl}`] : []),
    ];
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
        ...(tiered ? [tieredLines[0]] : [todayLine]),
        ...creditLines,
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
async function executeUsage(deps, raw, context) {
    if (raw && typeof raw === "object" && Object.keys(raw).length > 0) {
        return fail(NO_ARGUMENTS);
    }
    if (!isGatedSession(deps, context.sessionID))
        return fail(GATED_TEXT);
    const result = await freePiRequest(deps, {
        path: "/me/stats",
        timeoutMs: 5_000,
        signal: context.signal,
        audience: "user",
    });
    if (!result.ok)
        return fail(result.text);
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
export async function registerUsageTool(ctx, deps) {
    return ctx.tool.transform((editor) => {
        editor.add({
            name: "free_pi_usage",
            description: "Report how much of the caller's free daily allowance is used, remaining credits, token counts and account tier. Read-only, takes no arguments, makes no changes.",
            input: NO_INPUT,
            options: { codemode: false },
            execute: (input, context) => executeUsage(deps, input, context),
        });
    });
}
