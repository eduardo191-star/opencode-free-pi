/**
 * `free_pi_subagent_read`, a transcript reader for child sessions.
 *
 * OpenCode's `subagent` tool reports the child's final output and pings the
 * parent when the child goes idle, but the parent cannot open the child's
 * conversation afterwards. This tool fills that gap: it reads the transcript
 * of a session that is really a child of the calling session, so the parent can
 * see every task the subagent ran (tool calls with input and result) and quote
 * its answer.
 *
 * Read-only. The session is checked against its `parentID`, so a model cannot
 * use it to read unrelated sessions.
 */
import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
export type Transcript = {
    readonly text: string;
    readonly messages: number;
    readonly truncated: boolean;
};
/**
 * Renders a session transcript, keeping the newest turns when it does not fit.
 * The final assistant text is repeated at the end so the parent can quote it
 * even when the middle of the transcript was dropped.
 */
export declare function formatTranscript(messages: readonly unknown[], maxChars?: number): Transcript;
export declare function registerSubagentTool(ctx: Plugin.Context, deps: Deps): Promise<{
    dispose: () => Promise<void>;
}>;
