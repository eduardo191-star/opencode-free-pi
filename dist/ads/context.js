/** Builds and redacts the ad context sent with a user turn. */
import { AD_CONTEXT_MAX_CHARS, TURN_REMINDER_MARKER } from "../constants.js";
import { cleanText } from "../utils/text.js";
/** Start of the synthetic user message OpenCode creates for a finished subagent. */
const SUBAGENT_RESULT_PREFIX = "<subagent ";
/**
 * User-role messages OpenCode injects on its own. They are stored as
 * `type: "synthetic"` but lowered to `user` on the wire, so the prefix is the
 * only signal the ad context can use.
 */
const SYNTHETIC_USER_PREFIXES = [
    SUBAGENT_RESULT_PREFIX,
    "<shell ",
    "Instructions from: ",
    "The server restarted while you were working.",
    "The previous response was interrupted.",
    "User requested that active blocking work be moved to the background.",
];
const AD_SECRET_PATTERNS = [
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
const AD_SECRET_ASSIGNMENT = /(?<![A-Za-z0-9_.-])(["']?)([A-Za-z0-9_.-]+)\1?(\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s"']{8,})/g;
const AD_SECRET_NAME = /api[_-]?key|secret|token|passwd|password|private[_-]?key|authorization/i;
export function redactAdSecrets(text) {
    let output = text;
    for (const [type, pattern] of AD_SECRET_PATTERNS) {
        output = output.replace(pattern, `[REDACTED:${type}]`);
    }
    return output.replace(AD_SECRET_ASSIGNMENT, (match, _quote, name, _separator, value) => {
        const head = match.slice(0, match.length - value.length);
        if (!AD_SECRET_NAME.test(name)) {
            return (head +
                (value[0] === '"' || value[0] === "'"
                    ? redactAdSecrets(value)
                    : value));
        }
        const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
        return `${head}${quote}[REDACTED:secret]${quote}`;
    });
}
export function adContextText(text) {
    if (!text)
        return undefined;
    const value = redactAdSecrets(text).trim();
    return value ? value.slice(0, AD_CONTEXT_MAX_CHARS) : undefined;
}
export function adContextFor(userText, assistantText) {
    const payload = {};
    const user = adContextText(userText);
    const assistant = adContextText(assistantText);
    if (user)
        payload.user = user;
    if (assistant)
        payload.assistant = assistant;
    if (!payload.user && !payload.assistant)
        return undefined;
    let encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    while (encoded.length > 4096 && (payload.user || payload.assistant)) {
        for (const key of ["user", "assistant"]) {
            const value = payload[key];
            if (value)
                payload[key] = value.slice(0, Math.floor(value.length / 2));
        }
        encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    }
    return encoded;
}
function roleOf(message) {
    const value = message.role ?? message.type;
    return value === "user" || value === "assistant" ? value : undefined;
}
function contentText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .filter((part) => part?.type === "text" &&
        typeof part.text === "string" &&
        part.synthetic !== true)
        .map((part) => part.text)
        .join("\n");
}
/** Latest non-empty assistant text from a message list. */
export function latestAssistantText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (roleOf(message) !== "assistant")
            continue;
        const text = cleanText(contentText(message.content));
        if (text)
            return text;
    }
    return "";
}
/** Latest user text from a message list. */
export function latestUserText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (roleOf(message) !== "user")
            continue;
        const text = messageText(message);
        // The plugin appends this after the ad turn is resolved; ignore it if the
        // event is reused so the next ad never describes the reminder itself.
        if (isRealUserTurn(text))
            return text;
    }
    return "";
}
function messageText(message) {
    return cleanText(typeof message.text === "string" ? message.text : contentText(message.content));
}
/**
 * A user-role message that is not the user's own turn.
 *
 * OpenCode lowers a finished subagent into a `user` message that starts with
 * `<subagent sessionID=… state=…>`, and the plugin's own per-turn reminder is
 * also a `user` message. Treating either as a new turn rotated the ad in the
 * middle of one user request and sent its internal ids as the ad context.
 */
function isRealUserTurn(text) {
    return (text.length > 0 &&
        !text.startsWith(TURN_REMINDER_MARKER) &&
        !SYNTHETIC_USER_PREFIXES.some((prefix) => text.startsWith(prefix)));
}
/** Number of real user turns; synthetic messages do not start a new one. */
export function countUserTurns(messages) {
    let count = 0;
    for (const message of messages) {
        if (roleOf(message) !== "user")
            continue;
        if (isRealUserTurn(messageText(message)))
            count += 1;
    }
    return count;
}
/** Latest user message id from a message list. */
export function latestUserMessageID(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (roleOf(message) !== "user")
            continue;
        if (!isRealUserTurn(messageText(message)))
            continue;
        if (typeof message.id === "string" && message.id)
            return message.id;
    }
    return undefined;
}
