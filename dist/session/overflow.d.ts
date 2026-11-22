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
/**
 * Approximate token count of a chat-completions body: every string in it,
 * message text and tool output alike, at the usual four characters per token.
 * Inline media counts at its base64 length, which is what the provider bills.
 */
export declare function measureRequestTokens(body: string): number;
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
