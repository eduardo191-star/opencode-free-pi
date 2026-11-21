/** Subscribes to core events that affect free-pi state. */
import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
export declare function subscribeEvents(ctx: Plugin.Context, deps: Deps, signal: AbortSignal): Promise<void>;
