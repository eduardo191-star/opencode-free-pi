/**
 * Builds session titles locally.
 *
 * free-pi charges credits and shows ads per model request, and the CLI never
 * spends a turn on a title. OpenCode asks the selected model for a title, so
 * the title hook answers from the first user message instead: the session gets
 * a real name immediately, no ad is fetched, and a failed title request can
 * never leave the session stuck on "New session".
 */
type TitleMessage = {
    role?: unknown;
    type?: unknown;
    text?: unknown;
    content?: unknown;
};
/** Derives a title from the first meaningful line of the title request. */
export declare function localTitle(messages: readonly TitleMessage[] | undefined): string;
export {};
