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
import type { Deps } from "../deps.js";
import type { ModelDefinition } from "../types.js";
export declare const FUSION_ID = "fusion";
export declare const FUSION_PLANNER_ID = "deepseek-v4-pro";
export declare const FUSION_EXECUTOR_ID = "deepseek-v4-flash";
export declare const FUSION_FALLBACK_PLANNER_ID = "deepseek-v4-flash";
export declare const FUSION_GUIDELINE = "Fusion: if the task needs any file changes, first gather the context with read-only tools (read, grep, glob) and make no edits. Then call fusion_plan with a summary of what you found and what the task needs, BEFORE any edit or write; the planning model writes the plan and you carry it out. Once the plan exists, record it with the todo tool, then carry out the unfinished items yourself (edit, write tests, run them) and finish the user's task. Only a task that needs no file changes (a plain question) is answered directly without fusion_plan.";
export type FusionIds = {
    readonly planner: string;
    readonly executor: string;
};
/**
 * Picks the planner and executor from the live catalog, like the CLI: prefer
 * the server-provided pair, then Pro when the account has premium credits, then
 * Flash for both roles.
 */
export declare function resolveFusionIds(modelIDs: readonly string[], defaultModelID?: string, options?: {
    readonly server?: {
        planner?: string;
        executor?: string;
    };
    readonly hasPremium?: boolean;
}): FusionIds | undefined;
/**
 * The CLI asks `/me` before offering the Pro planner: without premium credits
 * the Pro model refuses the request, so Fusion plans with Flash instead. A
 * failed check keeps Pro, matching the CLI.
 */
export declare function premiumPlannerAvailable(deps: Deps): Promise<boolean>;
export declare function fusionName(ids: FusionIds): string;
/** Adds the virtual model next to the catalog models. */
export declare function addFusionModel(models: Record<string, ModelDefinition>, ids: FusionIds): string | undefined;
export declare function registerFusionTool(ctx: Plugin.Context, deps: Deps, ids: FusionIds): Promise<{
    dispose: () => Promise<void>;
}>;
