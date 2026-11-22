/**
 * Tool outcome headers, mirroring the free-pi provider CLI's
 * `free-pi-tool-outcomes` extension:
 *
 * - `x-freepi-tool-meta: v1:<id>~<ms>~<exit>~<truncated>,...`
 * - `x-freepi-tool-errors: v1:<ids>` (`v1x:` once old IDs were evicted)
 * - `x-freepi-compacted: v1:<dropped messages>` on the request after compaction
 */
import type { Deps } from "../deps.js";
/**
 * Every tool this plugin adds. They are registered globally because OpenCode's
 * tool editor has no provider filter, so the plugin hides them from requests
 * served by another provider (see `hideFreePiTools`) and refuses to run them
 * outside a free-pi session.
 */
export declare const FREE_PI_TOOL_NAMES: readonly ["look_at_image", "free_pi_usage", "web_search", "docs_lookup", "generate_image"];
type ToolResultLike = {
    metadata?: Record<string, unknown>;
};
type ToolEnd = {
    id: string;
    tool: string;
    status: "completed" | "error";
    result?: ToolResultLike;
};
/**
 * Whether this session is currently served by free-pi. The last request's
 * model wins over the historical set, so a session that switches to another
 * provider stops seeing free-pi's tools and headers immediately.
 */
export declare function isFreePiSession(deps: Deps, sessionID: string): boolean;
export declare function recordToolStart(deps: Deps, sessionID: string, id: string): void;
export declare function recordToolEnd(deps: Deps, sessionID: string, end: ToolEnd): void;
export declare function recordCompaction(deps: Deps, sessionID: string, droppedMessages: number): void;
/**
 * Headers for the outgoing request. `consumeCompacted` is false for the
 * compaction request itself so the marker lands on the request that follows.
 */
export declare function toolHeaders(deps: Deps, sessionID: string, consumeCompacted: boolean): Record<string, string>;
export declare function forgetToolStats(deps: Deps, sessionID: string): void;
export {};
