/**
 * Builds session titles locally.
 *
 * free-pi charges credits and shows ads per model request, and the CLI never
 * spends a turn on a title. OpenCode asks the selected model for a title, so
 * the title hook answers from the first user message instead: the session gets
 * a real name immediately, no ad is fetched, and a failed title request can
 * never leave the session stuck on "New session".
 */
const MAX_TITLE_LENGTH = 60;
const MAX_SOURCE_LENGTH = 4_000;
const MESSAGE_BLOCK = /<message>([\s\S]*?)<\/message>/i;
const CONVERSATION_BLOCK = /<conversation>([\s\S]*?)<\/conversation>/i;
const PREFIX = /^(?:original request|recent conversation|user|assistant)\s*:\s*/i;
const NOISE = /^(?:```[\w-]*|---+|===+|\*\*\*+)$/;
const XML_LINE = /^<\/?[a-z][^>]*>$/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
function textOf(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
}
function latestUserText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const role = message?.role ?? message?.type;
        if (role !== "user")
            continue;
        const text = typeof message?.text === "string"
            ? message.text
            : textOf(message?.content);
        if (text.trim())
            return text;
    }
    return "";
}
/** OpenCode wraps the source in `<message>` or `<conversation>` tags. */
function sourceText(messages) {
    const raw = latestUserText(messages);
    const block = MESSAGE_BLOCK.exec(raw)?.[1] ?? CONVERSATION_BLOCK.exec(raw)?.[1] ?? raw;
    return block.slice(0, MAX_SOURCE_LENGTH);
}
function cleanLine(line) {
    let value = line.replace(CONTROL, " ").trim();
    if (!value)
        return undefined;
    value = value
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*+>]\s+/, "")
        .trim();
    value = value.replace(PREFIX, "").trim();
    if (!value || NOISE.test(value) || XML_LINE.test(value))
        return undefined;
    value = value.replace(/^["'`]+|["'`]+$/g, "").trim();
    return value || undefined;
}
function truncate(value) {
    if (value.length <= MAX_TITLE_LENGTH)
        return value;
    const cut = value.slice(0, MAX_TITLE_LENGTH - 3);
    const space = cut.lastIndexOf(" ");
    return `${(space >= 20 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
/** Derives a title from the first meaningful line of the title request. */
export function localTitle(messages) {
    if (!Array.isArray(messages) || messages.length === 0)
        return "Session";
    const lines = sourceText(messages)
        .split(/\r?\n/)
        .map(cleanLine)
        .filter((line) => Boolean(line));
    const first = lines[0];
    if (!first)
        return "Session";
    return truncate(first.replace(/[\s:;,\-]+$/g, "").trim()) || "Session";
}
