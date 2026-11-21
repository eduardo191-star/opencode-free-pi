/**
 * Tool outcome headers, mirroring the free-pi provider CLI's
 * `free-pi-tool-outcomes` extension:
 *
 * - `x-freepi-tool-meta: v1:<id>~<ms>~<exit>~<truncated>,...`
 * - `x-freepi-tool-errors: v1:<ids>` (`v1x:` once old IDs were evicted)
 * - `x-freepi-compacted: v1:<dropped messages>` on the request after compaction
 */
import type { Deps } from "../deps.js";
type ToolResultLike = {
    metadata?: Record<string, unknown>;
};
type ToolEnd = {
    id: string;
    tool: string;
    status: "completed" | "error";
    result?: ToolResultLike;
};
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
