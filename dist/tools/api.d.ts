/**
 * Shared plumbing for the free-pi server tools.
 *
 * The provider CLI spends the user's daily allowance through a small set of
 * `/tools/*` and `/me*` endpoints. This module keeps the token handling,
 * timeouts and error wording identical across those tools.
 */
import type { Deps } from "../deps.js";
export type ToolOutput = {
    readonly content: ReadonlyArray<{
        readonly type: "text";
        readonly text: string;
    }>;
    readonly metadata: Record<string, unknown>;
};
export declare function done(text: string, metadata?: Record<string, unknown>): ToolOutput;
export declare function fail(text: string): ToolOutput;
export declare const GATED_TEXT = "This tool is only available in free-pi sessions.";
/** Same wording as the provider CLI when the integration is not connected. */
export declare const NO_TOKEN_TEXT = "This tool needs a free-pi sign-in. Do not retry; tell the user to connect the free-pi integration, and continue without this tool.";
export declare function isGatedSession(deps: Deps, sessionID: string | undefined): boolean;
export declare function friendlyThrown(error: unknown): string;
export declare function friendlyStatus(status: number, message?: unknown, audience?: "model" | "user"): string;
export type ApiResult = {
    readonly ok: true;
    readonly data: any;
} | {
    readonly ok: false;
    readonly status: number;
    readonly code: string;
    readonly text: string;
};
type RequestOptions = {
    readonly path: string;
    readonly method?: "GET" | "POST";
    readonly body?: unknown;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    /** Passed to `friendlyStatus` for non-mapped HTTP failures. */
    readonly audience?: "model" | "user";
    /** Prefix for timeout and transport errors, e.g. "The vision request". */
    readonly label?: string;
};
/**
 * Calls a free-pi endpoint with the current credential and never throws.
 * Business error codes are returned intact so each tool can map them to the
 * exact wording the provider CLI uses.
 */
export declare function freePiRequest(deps: Deps, options: RequestOptions): Promise<ApiResult>;
/** Maps a business error code to the CLI's wording, or keeps the HTTP text. */
export declare function mappedText(table: Record<string, string>, result: Extract<ApiResult, {
    ok: false;
}>, library?: string): string;
export {};
