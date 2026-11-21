/**
 * Fusion: DeepSeek Pro plans, Flash builds.
 *
 * The provider CLI registers a virtual "fusion" model. OpenCode gets the same
 * shape: a `fusion` model that routes its turns to the executor model, plus a
 * `fusion_plan` tool that asks the planner model for a plan through the
 * stateless generate API before any edit. The executor then carries the plan
 * out, exactly like the CLI.
 */

import type { Plugin } from "@opencode/plugin";
import { PROVIDER_ID } from "../constants.js";
import type { Deps } from "../deps.js";
import type { ModelDefinition } from "../types.js";
import {
  done,
  fail,
  freePiRequest,
  GATED_TEXT,
  isGatedSession,
} from "./api.js";

export const FUSION_ID = "fusion";
export const FUSION_PLANNER_ID = "deepseek-v4-pro";
export const FUSION_EXECUTOR_ID = "deepseek-v4-flash";
export const FUSION_FALLBACK_PLANNER_ID = "deepseek-v4-flash";

export const FUSION_GUIDELINE = `Fusion: if the task needs any file changes, first gather the context with read-only tools (read, grep, glob) and make no edits. Then call fusion_plan with a summary of what you found and what the task needs, BEFORE any edit or write; the planning model writes the plan and you carry it out. Once the plan exists, record it with the todo tool, then carry out the unfinished items yourself (edit, write tests, run them) and finish the user's task. Only a task that needs no file changes (a plain question) is answered directly without fusion_plan.`;

const PLAN_INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      maxLength: 6_000,
      description:
        "What you found during read-only exploration and what the task needs",
    },
  },
} as const;

export type FusionIds = {
  readonly planner: string;
  readonly executor: string;
};

/**
 * Picks the planner and executor from the live catalog, like the CLI: prefer
 * the server-provided pair, then Pro when the account has premium credits, then
 * Flash for both roles.
 */
export function resolveFusionIds(
  modelIDs: readonly string[],
  defaultModelID?: string,
  options: {
    readonly server?: { planner?: string; executor?: string };
    readonly hasPremium?: boolean;
  } = {},
): FusionIds | undefined {
  const has = (id: string | undefined): id is string =>
    typeof id === "string" && modelIDs.includes(id);
  const executor = has(FUSION_EXECUTOR_ID)
    ? FUSION_EXECUTOR_ID
    : has(defaultModelID)
      ? defaultModelID
      : undefined;
  if (!executor) return undefined;
  const server = options.server;
  if (server && has(server.planner) && has(server.executor)) {
    return { planner: server.planner, executor: server.executor };
  }
  const planner =
    options.hasPremium !== false && has(FUSION_PLANNER_ID)
      ? FUSION_PLANNER_ID
      : has(FUSION_FALLBACK_PLANNER_ID)
        ? FUSION_FALLBACK_PLANNER_ID
        : executor;
  return { planner, executor };
}

/**
 * The CLI asks `/me` before offering the Pro planner: without premium credits
 * the Pro model refuses the request, so Fusion plans with Flash instead. A
 * failed check keeps Pro, matching the CLI.
 */
export async function premiumPlannerAvailable(deps: Deps): Promise<boolean> {
  const result = await freePiRequest(deps, {
    path: "/me",
    timeoutMs: 5_000,
  });
  if (!result.ok) return true;
  const premium = result.data?.premium_credits;
  return typeof premium === "number" ? premium > 0 : true;
}

export function fusionName(ids: FusionIds): string {
  if (ids.planner === FUSION_PLANNER_ID) {
    return "🧬 Fusion · DeepSeek Pro plans, Flash builds";
  }
  if (ids.planner === FUSION_FALLBACK_PLANNER_ID) {
    return "🧬 Fusion · DeepSeek Flash plans and builds";
  }
  return "🧬 Fusion";
}

/** Adds the virtual model next to the catalog models. */
export function addFusionModel(
  models: Record<string, ModelDefinition>,
  ids: FusionIds,
): string | undefined {
  const base = models[ids.executor];
  if (!base) return undefined;
  models[FUSION_ID] = {
    ...base,
    id: FUSION_ID,
    name: fusionName(ids),
    release_date: base.release_date,
  };
  return FUSION_ID;
}

function plannerPrompt(summary: string): string {
  return `You are the planning model in a two-model setup. Another model gathered the context below and will carry out the plan; it can edit files and run commands, but it cannot see this conversation.

Task context from the executor:
${summary}

Write a concrete step-by-step plan: the files to change, the exact changes, and the tests to add and run. Be specific enough that the executor does not need to re-explore. Do not edit files or run commands. Reply with the plan only.`;
}

async function plan(
  ctx: Plugin.Context,
  deps: Deps,
  plannerID: string,
  summary: string,
): Promise<string | undefined> {
  const generate = (ctx as any).experimental?.generate?.text;
  if (typeof generate !== "function") {
    deps.log.warn("fusion_plan: this OpenCode build has no stateless generate");
    return undefined;
  }
  try {
    const result = await generate({
      prompt: plannerPrompt(summary),
      model: { providerID: PROVIDER_ID, id: plannerID },
    });
    const text = result?.text ?? result?.data?.text;
    return typeof text === "string" && text.trim() ? text.trim() : undefined;
  } catch (error: any) {
    deps.log.warn("fusion_plan: the planner request failed", {
      planner: plannerID,
      message: String(error?.message ?? error),
    });
    return undefined;
  }
}

async function executeFusionPlan(
  ctx: Plugin.Context,
  deps: Deps,
  ids: FusionIds,
  raw: unknown,
  context: { readonly sessionID: string; readonly signal: AbortSignal },
) {
  if (!isGatedSession(deps, context.sessionID)) return fail(GATED_TEXT);
  const summary =
    typeof (raw as any)?.summary === "string"
      ? (raw as any).summary.trim()
      : "";
  if (!summary) return fail("fusion_plan needs a summary of the task context.");

  const startedAt = Date.now();
  let usedPlanner = ids.planner;
  let text = await plan(ctx, deps, ids.planner, summary);
  if (!text && ids.planner !== FUSION_FALLBACK_PLANNER_ID) {
    // Pro needs premium credits; without them it refuses the request, so let
    // Flash plan instead of losing the turn.
    usedPlanner = FUSION_FALLBACK_PLANNER_ID;
    text = await plan(ctx, deps, usedPlanner, summary);
  }
  if (!text) {
    deps.log.warn("fusion_plan could not reach the planner; planning locally", {
      planner: ids.planner,
    });
    return done(
      "The planner is unavailable, so write the step-by-step plan yourself with the todo tool, one item per step. Do not edit files until the plan is recorded, then carry it out.",
      { ok: false, planner: ids.planner },
    );
  }

  deps.log.info("fusion_plan answered", {
    planner: usedPlanner,
    ms: Date.now() - startedAt,
    chars: text.length,
  });
  return done(
    `Plan from the Fusion planner (${usedPlanner}). Record it with the todo tool if it is not already there, then carry it out:\n\n${text}`,
    { ok: true, planner: usedPlanner, elapsed_ms: Date.now() - startedAt },
  );
}

export async function registerFusionTool(
  ctx: Plugin.Context,
  deps: Deps,
  ids: FusionIds,
): Promise<{ dispose: () => Promise<void> }> {
  return ctx.tool.transform((editor) => {
    editor.add({
      name: "fusion_plan",
      description:
        "Fusion only: hand off to the planning model once you have gathered enough context. Takes a summary of what you found and what the task needs, and returns a step-by-step plan to carry out.",
      input: PLAN_INPUT,
      options: { codemode: false },
      execute: (input: unknown, context: any) =>
        executeFusionPlan(ctx, deps, ids, input, context),
    } as any);
  });
}
