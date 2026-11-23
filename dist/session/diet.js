/**
 * Keeps a primary request inside the range where free models still attend to
 * the system prompt and the recent turns.
 *
 * Long free-pi sessions reach 100k-170k token prompts because every `read`,
 * `grep` and `shell` result stays verbatim forever. At that size the free
 * models lose the middle of the conversation and stop following the working
 * rules even though the gateway accepts the request. Whole turns cannot be
 * dropped: the user's wording and the assistant's decisions must survive. Only
 * stale tool payloads are collapsed, and the newest messages are never touched.
 */
/** Characters of a pruned tool result that stay readable at the head. */
const STUB_HEAD_CHARS = 600;
/** Characters kept from the end of a pruned result (summaries, errors, totals). */
const STUB_TAIL_CHARS = 240;
/** A result smaller than this is left alone: stubbing it saves nothing. */
const MIN_PRUNE_CHARS = STUB_HEAD_CHARS + STUB_TAIL_CHARS + 400;
function messageRole(message) {
    const role = message?.role;
    return typeof role === "string" ? role : undefined;
}
/** Text of a tool result in either the request shape or the native one. */
function textOfContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    let text = "";
    for (const part of content) {
        if (typeof part?.text === "string")
            text += part.text;
    }
    return text;
}
function onlyTextParts(content) {
    if (!Array.isArray(content))
        return false;
    return content.every((part) => part?.type === "text" || typeof part?.text === "string");
}
function stub(text) {
    const head = text.slice(0, STUB_HEAD_CHARS);
    const tail = text.length > STUB_HEAD_CHARS + STUB_TAIL_CHARS
        ? text.slice(-STUB_TAIL_CHARS)
        : "";
    const cut = text.length - head.length - tail.length;
    const note = `[... ${cut} characters of this tool result were pruned so the prompt stays readable; call the tool again if you need them]`;
    return tail ? `${head}\n${note}\n${tail}` : `${head}\n${note}`;
}
/**
 * The same message with its tool result collapsed, or `undefined` when the
 * message has nothing worth pruning. Both shapes are supported: OpenAI-style
 * `role: "tool"` messages and the native assistant parts with `state.content`.
 */
function shrunk(message) {
    const role = messageRole(message);
    const record = message;
    if (role === "tool") {
        const text = typeof record.content === "string"
            ? record.content
            : onlyTextParts(record.content)
                ? textOfContent(record.content)
                : "";
        if (text.length < MIN_PRUNE_CHARS)
            return undefined;
        return { ...record, content: stub(text) };
    }
    if (role !== "assistant" || !Array.isArray(record.content))
        return undefined;
    const parts = record.content;
    let changed = false;
    const next = parts.map((part) => {
        if (part?.type !== "tool" || !part.state)
            return part;
        const text = textOfContent(part.state.content);
        if (text.length < MIN_PRUNE_CHARS)
            return part;
        changed = true;
        return {
            ...part,
            state: { ...part.state, content: [{ type: "text", text: stub(text) }] },
        };
    });
    return changed ? { ...record, content: next } : undefined;
}
/**
 * Collapses stale tool results until the request fits `budget` tokens. The
 * newest messages (up to half the budget) are protected so the model always
 * sees what it was doing. Returns the same list untouched when it already fits.
 */
export function pruneStaleToolResults(messages, budget, estimate) {
    const tokensBefore = messages.reduce((sum, message) => sum + estimate(message), 0);
    if (messages.length === 0 || !(budget > 0) || tokensBefore <= budget) {
        return { messages, pruned: 0, tokensBefore, tokensAfter: tokensBefore };
    }
    const sizes = messages.map(estimate);
    let protectedStart = messages.length;
    let tail = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const size = sizes[index];
        if (tail > 0 && tail + size > budget * 0.5)
            break;
        tail += size;
        protectedStart = index;
    }
    const out = [...messages];
    let total = tokensBefore;
    let pruned = 0;
    for (let index = 0; index < protectedStart && total > budget; index += 1) {
        const smaller = shrunk(out[index]);
        if (!smaller)
            continue;
        const size = estimate(smaller);
        if (size >= sizes[index])
            continue;
        total -= sizes[index] - size;
        sizes[index] = size;
        out[index] = smaller;
        pruned += 1;
    }
    if (pruned === 0) {
        return { messages, pruned: 0, tokensBefore, tokensAfter: tokensBefore };
    }
    return { messages: out, pruned, tokensBefore, tokensAfter: total };
}
