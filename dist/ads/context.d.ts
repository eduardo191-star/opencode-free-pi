/** Builds and redacts the ad context sent with a user turn. */
export declare function redactAdSecrets(text: string): string;
export declare function adContextText(text: string | undefined): string | undefined;
export declare function adContextFor(userText: string, assistantText?: string): string | undefined;
/** A message from either a session record or a provider request. */
export type AdMessage = {
    type?: unknown;
    role?: unknown;
    id?: unknown;
    text?: unknown;
    content?: unknown;
};
/** Latest non-empty assistant text from a message list. */
export declare function latestAssistantText(messages: readonly AdMessage[]): string;
/** Latest user text from a message list. */
export declare function latestUserText(messages: readonly AdMessage[]): string;
/** Latest user message id from a message list. */
export declare function latestUserMessageID(messages: readonly AdMessage[]): string | undefined;
