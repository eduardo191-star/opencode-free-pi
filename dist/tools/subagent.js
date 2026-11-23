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
import { done, fail, GATED_TEXT, isGatedSession } from "./api.js";
const DEFAULT_MAX_CHARS = 60_000;
const MIN_MAX_CHARS = 2_000;
const MAX_MAX_CHARS = 200_000;
const TOOL_RESULT_CHARS = 2_000;
const TOOL_INPUT_CHARS = 1_500;
const USER_TEXT_CHARS = 8_000;
const ASSISTANT_TEXT_CHARS = 16_000;
const INPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        sessionID: {
            type: "string",
            description: "Child session to read, as returned by the `subagent` tool. Omit it to list this session's children.",
        },
        maxChars: {
            type: "integer",
            minimum: MIN_MAX_CHARS,
            maximum: MAX_MAX_CHARS,
            description: `Transcript budget in characters (default ${DEFAULT_MAX_CHARS}). The newest turns are kept.`,
        },
    },
};
function cut(value, limit) {
    const text = value.trim();
    if (text.length <= limit)
        return text;
    return `${text.slice(0, limit)}\n[... ${text.length - limit} characters cut]`;
}
function stringify(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value, null, 2) ?? "";
    }
    catch {
        return String(value ?? "");
    }
}
function textOfContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .filter((part) => part?.type === "text" && part.synthetic !== true)
        .map((part) => part.text ?? "")
        .join("\n");
}
function formatTool(part) {
    const status = part.state?.status ?? "unknown";
    const header = `[tool ${part.name ?? "?"}] ${status}`;
    const input = stringify(part.state?.input ?? {});
    const output = textOfContent(part.state?.content);
    return [
        header,
        `input: ${cut(input, TOOL_INPUT_CHARS)}`,
        ...(output.trim() ? [`result: ${cut(output, TOOL_RESULT_CHARS)}`] : []),
    ].join("\n");
}
function formatMessage(message) {
    const role = message.role ?? message.type;
    if (role === "user") {
        const text = message.text ?? textOfContent(message.content);
        return text.trim() ? `[user]\n${cut(text, USER_TEXT_CHARS)}` : "";
    }
    if (role !== "assistant")
        return "";
    const blocks = [];
    const content = Array.isArray(message.content) ? message.content : [];
    for (const part of content) {
        if (part?.type === "text" && part.synthetic !== true) {
            const text = part.text ?? "";
            if (text.trim())
                blocks.push(cut(text, ASSISTANT_TEXT_CHARS));
        }
        else if (part?.type === "tool") {
            blocks.push(formatTool(part));
        }
    }
    if (blocks.length === 0)
        return "";
    const finish = message.finish && message.finish !== "stop" ? ` (${message.finish})` : "";
    return `[assistant${message.agent ? ` ${message.agent}` : ""}]${finish}\n${blocks.join("\n\n")}`;
}
/**
 * Renders a session transcript, keeping the newest turns when it does not fit.
 * The final assistant text is repeated at the end so the parent can quote it
 * even when the middle of the transcript was dropped.
 */
export function formatTranscript(messages, maxChars = DEFAULT_MAX_CHARS) {
    const budget = Math.max(MIN_MAX_CHARS, Math.min(maxChars, MAX_MAX_CHARS));
    const entries = messages
        .map(formatMessage)
        .filter((entry) => entry.length > 0);
    let text = entries.join("\n\n");
    if (text.length <= budget) {
        return { text, messages: entries.length, truncated: false };
    }
    const kept = [];
    let size = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (size + entry.length + 2 > budget)
            break;
        kept.unshift(entry);
        size += entry.length + 2;
    }
    const dropped = entries.length - kept.length;
    const notice = `[... ${dropped} older transcript block${dropped === 1 ? "" : "s"} omitted to stay inside ${budget} characters; pass a larger maxChars to see them]`;
    text = [notice, ...kept].join("\n\n");
    return { text, messages: entries.length, truncated: true };
}
function listLine(session) {
    const when = session.updated
        ? new Date(session.updated).toISOString()
        : "unknown time";
    return `- ${session.id} - ${session.title ?? "(untitled)"} - agent ${session.agent ?? "?"} - ${session.outcome ?? "unknown"} - updated ${when}`;
}
async function execute(deps, raw, context) {
    if (!isGatedSession(deps, context.sessionID))
        return fail(GATED_TEXT);
    const input = (raw ?? {});
    const requested = typeof input.sessionID === "string" && input.sessionID.trim()
        ? input.sessionID.trim()
        : undefined;
    if (!requested) {
        const children = deps.listSubagentSessions
            ? await deps.listSubagentSessions(context.sessionID).catch(() => [])
            : [];
        if (children.length === 0) {
            return done("This session has no child sessions yet. The `subagent` tool returns a sessionID when a child starts.", { ok: true, children: 0 });
        }
        return done(["Child sessions of this session:", ...children.map(listLine)].join("\n"), { ok: true, children: children.length });
    }
    if (!deps.readSession) {
        return fail("Reading subagent sessions is not available in this OpenCode build.");
    }
    const info = await deps.readSession(requested).catch(() => undefined);
    if (!info)
        return fail(`No OpenCode session with id ${requested}.`);
    if (info.parentID !== context.sessionID) {
        return fail(`${requested} is not a subagent of this session, so its transcript cannot be read here.`);
    }
    const messages = await deps.readContext(requested).catch(() => []);
    if (messages.length === 0) {
        return done(`The subagent session ${requested} has no messages yet. It may still be starting.`, { ok: false, sessionID: requested, messages: 0 });
    }
    const budget = typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
        ? input.maxChars
        : DEFAULT_MAX_CHARS;
    const transcript = formatTranscript(messages, budget);
    const header = [
        `Subagent session ${requested}${info.title ? ` - ${info.title}` : ""}`,
        `agent: ${info.agent ?? "?"} - outcome: ${info.outcome ?? "running"} - stored messages: ${messages.length}`,
    ].join("\n");
    deps.log.info("free_pi_subagent_read answered", {
        sessionID: context.sessionID,
        child: requested,
        messages: transcript.messages,
        truncated: transcript.truncated,
    });
    return done(`${header}\n\n${transcript.text}`, {
        ok: true,
        sessionID: requested,
        parentID: info.parentID,
        agent: info.agent,
        outcome: info.outcome,
        messages: transcript.messages,
        truncated: transcript.truncated,
    });
}
export async function registerSubagentTool(ctx, deps) {
    return ctx.tool.transform((editor) => {
        editor.add({
            name: "free_pi_subagent_read",
            description: "Read the transcript of a subagent session started from this session: its prompts, tool calls with inputs and results, and final answer. Pass the child sessionID returned by `subagent`, or omit it to list this session's children. Read-only; only child sessions of the calling session are readable.",
            input: INPUT_SCHEMA,
            options: { codemode: false },
            execute: (input, context) => execute(deps, input, context),
        });
    });
}
