/**
 * `free_pi_usage`, the free-pi allowance tool.
 *
 * Mirrors the provider CLI: `GET /me/stats` and a compact, human-readable
 * summary. Read-only and gated to free-pi sessions.
 */
import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
export declare function formatUsage(stats: any): string;
export declare function registerUsageTool(ctx: Plugin.Context, deps: Deps): Promise<{
    dispose: () => Promise<void>;
}>;
