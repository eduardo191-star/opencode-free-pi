/**
 * Guards against a provider that reports a context overflow for a request that
 * plainly fits the model's window.
 *
 * free-pi returns `context_ceiling`/`context_too_long` when the upstream model
 * rejects a prompt as too long. The client turns that into OpenCode's
 * "prompt is too long" overflow, which is correct for a real overflow: the
 * runner compacts and retries. When the gateway is failing it can report the
 * same code for a small prompt, and then every compaction is followed by the
 * next rejection: an endless compact/retry storm that spends real credits on
 * summaries. A request far below the advertised window cannot be a window
 * overflow, so the plugin retries it on a fresh wire session and, if that
 * still fails, surfaces a provider error instead of asking for another
 * compaction.
 */
import type { Deps } from "../deps.js";
/** A request below this many tokens cannot exhaust a 200k window on its own. */
export declare const SPURIOUS_OVERFLOW_TOKENS = 60000;
export declare const SPURIOUS_OVERFLOW_MESSAGE: string;
export type RequestProfile = {
    /** Approximate token count of the whole body. */
    readonly tokens: number;
    /** The upstream model the body asks for, when it can be read. */
    readonly model?: string;
    /** Whether the body carries an inline image or file. */
    readonly hasMedia: boolean;
};
/**
 * Approximate token count of a chat-completions body: every string in it,
 * message text and tool output alike, at the usual four characters per token.
 * Inline media counts at its base64 length, which is what the provider bills.
 *
 * The same walk reports the requested model and whether the body carries
 * inline media. A rejection caused by a large attachment says nothing about
 * the model's text window, so callers must not learn a ceiling from it.
 */
export declare function profileRequest(body: string): RequestProfile;
/** Token count of a request body, without the extra facts. */
export declare function measureRequestTokens(body: string): number;
/**
 * Cheap per-message estimate; the body is serialized once per message.
 *
 * Assistant reasoning is stored in the session but the provider lowering drops
 * it before the request (`FREE_PI_TRACE` shows `reasoningChars: 0`). Counting it
 * made the diet and the compaction trim believe a prompt was 30-50k tokens
 * larger than the wire, so they pruned or dropped turns the model never saw.
 */
export declare function estimateMessageTokens(message: unknown): number;
/**
 * Keeps the newest part of a message list inside `budget` tokens, cutting only
 * at user turns so an assistant tool call never loses its results.
 *
 * OpenCode refuses to compact when the summarization request itself is still
 * too large, and then the turn dies with nothing but the checkpoint shown. The
 * gateway's real ceiling is lower than the advertised window, so the plugin
 * trims the oldest turns it can spare before the summarizer is asked to read
 * them.
 */
export declare function trimMessagesForBudget(messages: readonly unknown[], budget: number): {
    readonly messages: readonly unknown[];
    readonly dropped: number;
    readonly tokens: number;
};
/**
 * Records a rejection of a request that fits, and returns the number of them
 * seen for the session inside the current window. A run of them means the
 * provider is failing, so compacting again cannot help.
 */
export declare function noteSpuriousOverflow(deps: Deps, sessionID: string): number;
export declare function clearSpuriousOverflows(deps: Deps, sessionID: string): void;
/** Whether the session has had enough spurious rejections to stop compacting. */
export declare function overflowingSpuriously(deps: Deps, sessionID: string): boolean;
/**
 * Turns an overflow response into a provider error OpenCode will not classify
 * as a context overflow. The session still shows a failure, but the runner
 * stops compacting and retrying a conversation that already fits.
 */
export declare function spuriousOverflowResponse(original: Response): Response;
