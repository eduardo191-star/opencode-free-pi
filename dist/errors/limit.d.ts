/**
 * Rewrites long-lived free-pi limit responses so the client shows the friendly
 * message instead of a raw 429. Mirrors the fetch wrapper used by the V1 plugin.
 */
/** The free-pi overflow code carried by a response, when it is one. */
export declare function overflowCodeOf(response: Response): Promise<string | undefined>;
/**
 * Returns a replacement response when `response` is a free-pi context overflow.
 * The replacement is a 400 with a message OpenCode recognizes as context
 * overflow, so the session runner compacts and retries instead of surfacing
 * the fatal "conversation is too long" error.
 */
export declare function rewriteContextOverflowResponse(response: Response): Promise<Response | undefined>;
/**
 * Returns a replacement response when `response` is a 429 that represents a
 * long-lived limit. The replacement is a 400 with the same body but a friendly
 * message, so the model error surface reads it like any other failure.
 */
export declare function rewriteLimitResponse(response: Response): Promise<Response | undefined>;
