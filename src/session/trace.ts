/**
 * Diagnostic dump of what the plugin actually sends to free-pi.
 *
 * Enabled with `FREE_PI_TRACE=1`. It answers the questions the TUI and the
 * session database cannot: whether the tools travel complete, whether the
 * provider request keeps older reasoning, and whether the per-turn reminder is
 * the last message OpenCode sends. It never runs unless the env var is set.
 */

import type { Deps } from "../deps.js";

type TraceMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) =>
      typeof part?.text === "string"
        ? part.text
        : typeof part?.thinking === "string"
          ? part.thinking
          : "",
    )
    .join("");
}

export function traceRequestBody(
  deps: Deps,
  sessionID: string,
  body: string,
): void {
  if (process.env.FREE_PI_TRACE !== "1") return;
  try {
    const parsed = JSON.parse(body) as {
      model?: string;
      messages?: TraceMessage[];
      tools?: Array<{ function?: { name?: string } }>;
    };
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const roles: Record<string, number> = {};
    let textChars = 0;
    let reasoningChars = 0;
    let toolChars = 0;
    for (const message of messages) {
      const role = message.role ?? "?";
      roles[role] = (roles[role] ?? 0) + 1;
      if (Array.isArray(message.content)) {
        for (const part of message.content as any[]) {
          if (part?.type === "text" && typeof part.text === "string") {
            textChars += part.text.length;
          } else if (
            (part?.type === "reasoning" || part?.type === "thinking") &&
            typeof part.text === "string"
          ) {
            reasoningChars += part.text.length;
          } else if (part?.type === "tool-result") {
            toolChars += JSON.stringify(part.result ?? "").length;
          }
        }
      }
      if (typeof message.content === "string") {
        if (role === "tool") toolChars += message.content.length;
        else textChars += message.content.length;
      }
      if (Array.isArray(message.tool_calls)) {
        toolChars += JSON.stringify(message.tool_calls).length;
      }
    }
    const tools = Array.isArray(parsed.tools)
      ? parsed.tools.map((tool) => tool?.function?.name ?? "?")
      : [];
    const last = messages.at(-1);
    deps.log.info("free-pi trace request", {
      sessionID,
      model: parsed.model,
      messages: messages.length,
      roles,
      textChars,
      reasoningChars,
      toolChars,
      tools: tools.length,
      toolNames: tools,
      lastRole: last?.role,
      lastStart: textOf(last?.content).slice(0, 80).replace(/\n/g, " "),
    });
  } catch {
    // A body that is not JSON is not a model request worth tracing.
  }
}
