/** Identifiers and defaults shared by every part of the plugin. */
export declare const PROVIDER_ID = "free-pi";
export declare const DEFENSE_PROVIDER_ID = "free-pi-defense";
export declare const INTEGRATION_ID = "free-pi";
export declare const PROVIDER_NAME = "Free Pi";
export declare const DEFENSE_PROVIDER_NAME = "Free Pi Defense";
export declare const DEFAULT_BASE_URL = "https://api.freepi.ai";
export declare const DEFAULT_CLIENT_VERSION = "0.6.25";
export declare const CONSENT_VERSION = "4";
export declare const CONTEXT_WINDOW = 200000;
export declare const MAX_OUTPUT_TOKENS = 32768;
export declare const AD_CONTEXT_HEADER = "x-ad-context";
/**
 * The CLI sends `none` when the ad context is unavailable or private instead of
 * omitting the header; the server expects the explicit opt-out to rotate ads.
 */
export declare const AD_CONTEXT_OPT_OUT = "none";
export declare const SUBAGENT_HEADER = "x-freepi-subagent";
export declare const COST_EXPERIMENT_HEADER = "x-freepi-cost-exp";
export declare const EFFICIENCY_RULE = "- When several independent reads or searches are needed, issue them in the same turn.";
/**
 * The provider CLI registers every free-pi model with reasoning enabled and
 * defaults to thinking off. OpenCode only sends `reasoning_effort` when a
 * variant or model setting provides one, so the model carries the off default
 * and the picker offers the levels the CLI would.
 */
export declare const DEFAULT_REASONING_EFFORT = "none";
export declare const DEFAULT_THINKING_LEVELS: readonly ["minimal", "low", "medium", "high"];
/** pi-ai's HTTP idle timeout for headers and body chunks. */
export declare const HEADER_TIMEOUT_MS = 300000;
export declare const CHUNK_TIMEOUT_MS = 300000;
/** pi's retry policy: 3 retries, 2s base, 60s cap. */
export declare const RETRY_MAX_RETRIES = 3;
export declare const RETRY_BASE_DELAY_MS = 2000;
export declare const RETRY_MAX_DELAY_MS = 60000;
/**
 * free-pi allows one in-flight request per `x-session-id` and answers a second
 * one with `429 concurrent`. OpenCode does not retry that itself, and a slot
 * can leak server-side, so the plugin rotates the wire session id and retries.
 */
export declare const CONCURRENT_RETRY_MAX = 6;
export declare const CONCURRENT_RETRY_BASE_MS = 1000;
export declare const CONCURRENT_RETRY_MAX_DELAY_MS = 15000;
/** pi assumes a 5 minute prompt-cache TTL when explaining a miss. */
export declare const CACHE_TTL_MS: number;
export declare const CACHE_MISS_NOISE_FLOOR_TOKENS = 1024;
export declare const CACHE_MISS_NOTICE_TOKENS = 20000;
/** Tool outcome headers emitted by the free-pi provider CLI. */
export declare const TOOL_META_HEADER = "x-freepi-tool-meta";
export declare const TOOL_ERRORS_HEADER = "x-freepi-tool-errors";
export declare const COMPACTED_HEADER = "x-freepi-compacted";
export declare const TOOL_META_BUDGET = 1500;
export declare const TOOL_ID_LIMIT = 50;
/**
 * The `compact100` cost experiment reserves 100k tokens, so pi compacts when
 * the prompt reaches 100k. OpenCode compacts at `window - max(15%, 16k)`;
 * 117_647 is the smallest window that keeps that trigger at 100k.
 */
export declare const COMPACT100_TRIGGER_TOKENS = 100000;
export declare const COMPACT100_CONTEXT_WINDOW = 117647;
export declare const SESSION_TRACK_LIMIT = 200;
export declare const AUTH_SKEW_MS = 60000;
export declare const AUTH_TIMEOUT_MS: number;
export declare const AUTH_NETWORK_FAILURES = 6;
export declare const DEFAULT_TOKEN_LIFETIME_MS: number;
export declare const REFRESH_PREFIX = "free-pi:v1:";
export declare const AD_CONTEXT_MAX_CHARS = 1000;
export declare const AD_REQUEST_TIMEOUT_MS = 5000;
export declare const AD_IMPRESSION_TIMEOUT_MS = 3000;
export declare const AD_TURN_LIMIT = 200;
export declare const AD_IMPRESSION_LIMIT = 200;
export declare const CREDITS_PER_USD: number;
export declare const CATALOG_TTL_MS: number;
export declare const CATALOG_DISK_TTL_MS: number;
export declare const CATALOG_TIMEOUT_MS = 8000;
export declare const REGISTRY_TTL_MS: number;
export declare const REGISTRY_DISK_TTL_MS: number;
export declare const REGISTRY_RETRY_MS = 60000;
export declare const REGISTRY_TIMEOUT_MS = 3500;
export declare const REGISTRY_ATTEMPTS = 2;
export declare const DEFAULT_MODELS_REGISTRY_URL = "https://models.opencode.ai";
export declare const QUOTA_TTL_MS = 30000;
export declare const QUOTA_HTTP_TIMEOUT_MS = 5000;
export declare const QUOTA_REFRESH_DEBOUNCE_MS = 1000;
export declare const SESSION_RESET_COOLDOWN_MS = 15000;
/**
 * How long a free-pi session must stay quiet before its server slot is closed.
 * Background compaction can start right after the last step, so closing on the
 * execution event alone would race with it.
 */
export declare const SESSION_FINALIZE_DELAY_MS = 2000;
export declare const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";
