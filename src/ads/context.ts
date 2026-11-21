/** Builds and redacts the ad context sent with a user turn. */

import { AD_CONTEXT_MAX_CHARS } from "../constants.js";
import { cleanText } from "../utils/text.js";

const AD_SECRET_PATTERNS: Array<[string, RegExp]> = [
  [
    "private_key",
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{1,20000}?-----END [A-Z ]*PRIVATE KEY-----/g,
  ],
  [
    "private_key",
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\sA-Za-z0-9+/=]{20,20000}/g,
  ],
  ["anthropic_key", /\bsk-ant-[A-Za-z0-9_-]{20,255}/g],
  ["openrouter_key", /\bsk-or-v1-[A-Za-z0-9]{32,255}/g],
  ["api_key", /\bsk-[A-Za-z0-9_-]{20,255}/g],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g],
  ["stripe_secret", /\b[sr]k_(?:live|test)_[0-9A-Za-z]{20,255}/g],
  ["github_token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}/g],
  ["github_token", /\bgithub_pat_[A-Za-z0-9_]{22,255}/g],
  ["gitlab_token", /\bglpat-[A-Za-z0-9_-]{20,255}/g],
  ["aws_key_id", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{10,255}/g],
  [
    "jwt",
    /\beyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{8,1024}(?![A-Za-z0-9_-])/g,
  ],
  ["bearer", /\bBearer\s+[A-Za-z0-9._~+/=-]{16,512}/gi],
];

const AD_SECRET_ASSIGNMENT =
  /(?<![A-Za-z0-9_.-])(["']?)([A-Za-z0-9_.-]+)\1?(\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s"']{8,})/g;
const AD_SECRET_NAME =
  /api[_-]?key|secret|token|passwd|password|private[_-]?key|authorization/i;

export function redactAdSecrets(text: string): string {
  let output = text;
  for (const [type, pattern] of AD_SECRET_PATTERNS) {
    output = output.replace(pattern, `[REDACTED:${type}]`);
  }
  return output.replace(
    AD_SECRET_ASSIGNMENT,
    (
      match: string,
      _quote: string,
      name: string,
      _separator: string,
      value: string,
    ) => {
      const head = match.slice(0, match.length - value.length);
      if (!AD_SECRET_NAME.test(name)) {
        return (
          head +
          (value[0] === '"' || value[0] === "'"
            ? redactAdSecrets(value)
            : value)
        );
      }
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
      return `${head}${quote}[REDACTED:secret]${quote}`;
    },
  );
}

export function adContextText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const value = redactAdSecrets(text).trim();
  return value ? value.slice(0, AD_CONTEXT_MAX_CHARS) : undefined;
}

export function adContextFor(
  userText: string,
  assistantText?: string,
): string | undefined {
  const payload: { user?: string; assistant?: string } = {};
  const user = adContextText(userText);
  const assistant = adContextText(assistantText);
  if (user) payload.user = user;
  if (assistant) payload.assistant = assistant;
  if (!payload.user && !payload.assistant) return undefined;

  let encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  while (encoded.length > 4096 && (payload.user || payload.assistant)) {
    for (const key of ["user", "assistant"] as const) {
      const value = payload[key];
      if (value) payload[key] = value.slice(0, Math.floor(value.length / 2));
    }
    encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  }
  return encoded;
}

/** A message from either a session record or a provider request. */
export type AdMessage = {
  type?: unknown;
  role?: unknown;
  id?: unknown;
  text?: unknown;
  content?: unknown;
};

function roleOf(message: AdMessage): "user" | "assistant" | undefined {
  const value = message.role ?? message.type;
  return value === "user" || value === "assistant" ? value : undefined;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part: any) =>
        part?.type === "text" &&
        typeof part.text === "string" &&
        part.synthetic !== true,
    )
    .map((part: any) => part.text)
    .join("\n");
}

/** Latest non-empty assistant text from a message list. */
export function latestAssistantText(messages: readonly AdMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (roleOf(message) !== "assistant") continue;
    const text = cleanText(contentText(message.content));
    if (text) return text;
  }
  return "";
}

/** Latest user text from a message list. */
export function latestUserText(messages: readonly AdMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (roleOf(message) !== "user") continue;
    const text = cleanText(
      typeof message.text === "string" ? message.text : contentText(message.content),
    );
    if (text) return text;
  }
  return "";
}

/** Latest user message id from a message list. */
export function latestUserMessageID(
  messages: readonly AdMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (roleOf(message) !== "user") continue;
    if (typeof message.id === "string" && message.id) return message.id;
  }
  return undefined;
}
