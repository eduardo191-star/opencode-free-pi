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
export type DietResult = {
    readonly messages: readonly unknown[];
    readonly pruned: number;
    readonly tokensBefore: number;
    readonly tokensAfter: number;
};
/**
 * Collapses stale tool results until the request fits `budget` tokens. The
 * newest messages (up to half the budget) are protected so the model always
 * sees what it was doing. Returns the same list untouched when it already fits.
 */
export declare function pruneStaleToolResults(messages: readonly unknown[], budget: number, estimate: (message: unknown) => number): DietResult;
