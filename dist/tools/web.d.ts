/**
 * `web_search` and `docs_lookup`, backed by free-pi's `/tools/*` endpoints.
 *
 * Both spend part of the user's daily allowance, exactly like the provider
 * CLI, and are only exposed inside free-pi sessions.
 */
import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
export declare function formatWebResults(query: string, results: any[]): string;
export declare function registerWebTools(ctx: Plugin.Context, deps: Deps): Promise<{
    dispose: () => Promise<void>;
}>;
