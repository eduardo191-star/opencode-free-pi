/**
 * Rewrites long-lived free-pi limit responses so the client shows the friendly
 * message instead of a raw 429. Mirrors the fetch wrapper used by the V1 plugin.
 */
/**
 * Returns a replacement response when `response` is a 429 that represents a
 * long-lived limit. The replacement is a 400 with the same body but a friendly
 * message, so the model error surface reads it like any other failure.
 */
export declare function rewriteLimitResponse(response: Response): Promise<Response | undefined>;
