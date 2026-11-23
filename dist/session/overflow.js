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
/** A request below this many tokens cannot exhaust a 200k window on its own. */
export const SPURIOUS_OVERFLOW_TOKENS = 60_000;
/** Spurious rejections closer together than this belong to the same incident. */
const STORM_WINDOW_MS = 10 * 60_000;
/** Spurious rejections tolerated in a window before the error stops compacting. */
const STORM_LIMIT = 2;
const STORM_LIMIT_PER_SESSION = 512;
export const SPURIOUS_OVERFLOW_MESSAGE = "free-pi rejected this request as too long even though it fits the model's window; " +
    "this is a provider failure, not a context overflow. Retry the message, or start a new session if it persists.";
/** Part types that carry an inline image or file, which the provider bills in full. */
const MEDIA_PART_TYPES = new Set([
    "image",
    "image_url",
    "input_image",
    "file",
    "input_file",
]);
/**
 * Approximate token count of a chat-completions body: every string in it,
 * message text and tool output alike, at the usual four characters per token.
 * Inline media counts at its base64 length, which is what the provider bills.
 *
 * The same walk reports the requested model and whether the body carries
 * inline media. A rejection caused by a large attachment says nothing about
 * the model's text window, so callers must not learn a ceiling from it.
 */
export function profileRequest(body) {
    try {
        const data = JSON.parse(body);
        let chars = 0;
        let model;
        let hasMedia = false;
        const walk = (value) => {
            if (typeof value === "string") {
                chars += value.length;
                if (value.startsWith("data:image/") || value.startsWith("data:application/")) {
                    hasMedia = true;
                }
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value)
                    walk(item);
                return;
            }
            if (value && typeof value === "object") {
                const record = value;
                if (typeof record.type === "string" && MEDIA_PART_TYPES.has(record.type)) {
                    hasMedia = true;
                }
                if (model === undefined &&
                    typeof record.model === "string" &&
                    record.model.length > 0) {
                    model = record.model;
                }
                for (const [key, item] of Object.entries(record)) {
                    chars += key.length;
                    walk(item);
                }
            }
        };
        walk(data);
        return { tokens: Math.ceil(chars / 4), model, hasMedia };
    }
    catch {
        return { tokens: Math.ceil(body.length / 4), hasMedia: false };
    }
}
/** Token count of a request body, without the extra facts. */
export function measureRequestTokens(body) {
    return profileRequest(body).tokens;
}
/** Part types OpenCode keeps in the session but does not send to free-pi. */
const UNSENT_PART_TYPES = new Set(["reasoning", "thinking"]);
/**
 * Cheap per-message estimate; the body is serialized once per message.
 *
 * Assistant reasoning is stored in the session but the provider lowering drops
 * it before the request (`FREE_PI_TRACE` shows `reasoningChars: 0`). Counting it
 * made the diet and the compaction trim believe a prompt was 30-50k tokens
 * larger than the wire, so they pruned or dropped turns the model never saw.
 */
export function estimateMessageTokens(message) {
    try {
        const full = JSON.stringify(message).length;
        const content = message?.content;
        if (!Array.isArray(content))
            return Math.ceil(full / 4);
        let unsent = 0;
        for (const part of content) {
            if (UNSENT_PART_TYPES.has(part?.type ?? "")) {
                unsent += JSON.stringify(part).length + 1;
            }
        }
        return Math.ceil(Math.max(0, full - unsent) / 4);
    }
    catch {
        return 0;
    }
}
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
export function trimMessagesForBudget(messages, budget) {
    if (messages.length === 0)
        return { messages, dropped: 0, tokens: 0 };
    const sizes = messages.map(estimateMessageTokens);
    let total = 0;
    for (const size of sizes)
        total += size;
    if (total <= budget)
        return { messages, dropped: 0, tokens: total };
    const cuts = [];
    for (let index = 1; index < messages.length; index += 1) {
        const role = messages[index]?.role;
        if (role === "user")
            cuts.push(index);
    }
    for (const cut of cuts) {
        let tail = 0;
        for (let index = cut; index < sizes.length; index += 1)
            tail += sizes[index];
        if (tail <= budget) {
            return { messages: messages.slice(cut), dropped: cut, tokens: tail };
        }
    }
    const last = cuts.length > 0 ? cuts[cuts.length - 1] : messages.length - 1;
    let tail = 0;
    for (let index = last; index < sizes.length; index += 1)
        tail += sizes[index];
    return { messages: messages.slice(last), dropped: last, tokens: tail };
}
/**
 * Records a rejection of a request that fits, and returns the number of them
 * seen for the session inside the current window. A run of them means the
 * provider is failing, so compacting again cannot help.
 */
export function noteSpuriousOverflow(deps, sessionID) {
    if (!sessionID)
        return 0;
    const now = Date.now();
    const previous = deps.state.spuriousOverflows.get(sessionID);
    const count = previous && now - previous.at <= STORM_WINDOW_MS ? previous.count + 1 : 1;
    deps.state.spuriousOverflows.set(sessionID, { at: now, count });
    if (deps.state.spuriousOverflows.size > STORM_LIMIT_PER_SESSION) {
        const oldest = deps.state.spuriousOverflows.keys().next().value;
        if (oldest !== undefined)
            deps.state.spuriousOverflows.delete(oldest);
    }
    return count;
}
export function clearSpuriousOverflows(deps, sessionID) {
    deps.state.spuriousOverflows.delete(sessionID);
}
/** Whether the session has had enough spurious rejections to stop compacting. */
export function overflowingSpuriously(deps, sessionID) {
    const entry = deps.state.spuriousOverflows.get(sessionID);
    if (!entry)
        return false;
    if (Date.now() - entry.at > STORM_WINDOW_MS)
        return false;
    return entry.count > STORM_LIMIT;
}
/**
 * Turns an overflow response into a provider error OpenCode will not classify
 * as a context overflow. The session still shows a failure, but the runner
 * stops compacting and retrying a conversation that already fits.
 */
export function spuriousOverflowResponse(original) {
    const headers = new Headers(original.headers);
    headers.delete("retry-after");
    headers.delete("retry-after-ms");
    headers.set("x-free-pi-spurious-overflow", "1");
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify({
        error: { type: "provider_error", message: SPURIOUS_OVERFLOW_MESSAGE },
        message: SPURIOUS_OVERFLOW_MESSAGE,
    }), { status: 400, statusText: "Bad Request", headers });
}
