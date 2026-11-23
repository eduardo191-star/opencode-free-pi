/**
 * The newest turns of a session, quoted back into the compaction request.
 *
 * OpenCode keeps only the latest exchange beside the summary and shortens tool
 * output before the summarizer reads it. For a session that has just done real
 * work (a long build, a refactor, a failing test) that means the summary can
 * lose the request that was being solved and the results that prove it. The
 * plugin can read the whole session through the native API, so it quotes the
 * tail verbatim into the compaction request and asks for it in the summary.
 */
export type RecentWindow = {
    /** The rendered tail of the session, oldest turn first. */
    readonly text: string;
    /** Messages that carried text or tool work. */
    readonly messages: number;
    /** Whether older turns were dropped to stay inside the budget. */
    readonly truncated: boolean;
};
/**
 * Renders the newest turns of `messages` inside `maxChars`, keeping the end.
 * Returns `undefined` when the session has nothing worth quoting.
 */
export declare function buildRecentWindow(messages: readonly unknown[], maxChars?: number, maxMessages?: number): RecentWindow | undefined;
/** The system block that turns the quoted turns into part of the summary. */
export declare function recentWindowGuidance(window: RecentWindow): string;
/**
 * The same window, handed to the first request after a compaction. It covers
 * the case where the summary compressed the newest turns anyway.
 */
export declare function carriedWindowGuidance(text: string): string;
