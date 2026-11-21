/** Identifiers and defaults shared by every part of the plugin. */
export const PROVIDER_ID = "free-pi";
export const DEFENSE_PROVIDER_ID = "free-pi-defense";
export const INTEGRATION_ID = PROVIDER_ID;
export const PROVIDER_NAME = "Free Pi";
export const DEFENSE_PROVIDER_NAME = "Free Pi Defense";
export const DEFAULT_BASE_URL = "https://api.freepi.ai";
export const DEFAULT_CLIENT_VERSION = "0.6.25";
export const CONSENT_VERSION = "4";
export const CONTEXT_WINDOW = 200_000;
export const MAX_OUTPUT_TOKENS = 32_768;
export const AD_CONTEXT_HEADER = "x-ad-context";
export const SUBAGENT_HEADER = "x-freepi-subagent";
export const COST_EXPERIMENT_HEADER = "x-freepi-cost-exp";
export const EFFICIENCY_RULE = "- When several independent reads or searches are needed, issue them in the same turn.";
/**
 * The provider CLI registers every free-pi model with reasoning enabled and
 * defaults to thinking off. OpenCode only sends `reasoning_effort` when a
 * variant or model setting provides one, so the model carries the off default
 * and the picker offers the levels the CLI would.
 */
export const DEFAULT_REASONING_EFFORT = "none";
export const DEFAULT_THINKING_LEVELS = [
    "minimal",
    "low",
    "medium",
    "high",
];
/** pi-ai's HTTP idle timeout for headers and body chunks. */
export const HEADER_TIMEOUT_MS = 300_000;
export const CHUNK_TIMEOUT_MS = 300_000;
/** pi's retry policy: 3 retries, 2s base, 60s cap. */
export const RETRY_MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 2_000;
export const RETRY_MAX_DELAY_MS = 60_000;
/** pi assumes a 5 minute prompt-cache TTL when explaining a miss. */
export const CACHE_TTL_MS = 5 * 60_000;
export const CACHE_MISS_NOISE_FLOOR_TOKENS = 1_024;
export const CACHE_MISS_NOTICE_TOKENS = 20_000;
/** Tool outcome headers emitted by the free-pi provider CLI. */
export const TOOL_META_HEADER = "x-freepi-tool-meta";
export const TOOL_ERRORS_HEADER = "x-freepi-tool-errors";
export const COMPACTED_HEADER = "x-freepi-compacted";
export const TOOL_META_BUDGET = 1_500;
export const TOOL_ID_LIMIT = 50;
/**
 * The `compact100` cost experiment reserves 100k tokens, so pi compacts when
 * the prompt reaches 100k. OpenCode compacts at `window - max(15%, 16k)`;
 * 117_647 is the smallest window that keeps that trigger at 100k.
 */
export const COMPACT100_TRIGGER_TOKENS = 100_000;
export const COMPACT100_CONTEXT_WINDOW = 117_647;
export const SESSION_TRACK_LIMIT = 200;
export const AUTH_SKEW_MS = 60_000;
export const AUTH_TIMEOUT_MS = 15 * 60_000;
export const AUTH_NETWORK_FAILURES = 6;
export const DEFAULT_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60_000;
export const REFRESH_PREFIX = "free-pi:v1:";
export const AD_CONTEXT_MAX_CHARS = 1_000;
export const AD_REQUEST_TIMEOUT_MS = 5_000;
export const AD_IMPRESSION_TIMEOUT_MS = 3_000;
export const AD_TURN_LIMIT = 200;
export const AD_IMPRESSION_LIMIT = 200;
export const CREDITS_PER_USD = 40_000 / 3;
export const CATALOG_TTL_MS = 10 * 60_000;
export const CATALOG_DISK_TTL_MS = 24 * 60 * 60_000;
export const CATALOG_TIMEOUT_MS = 8_000;
export const REGISTRY_TTL_MS = 5 * 60_000;
export const REGISTRY_DISK_TTL_MS = 7 * 24 * 60 * 60_000;
export const REGISTRY_RETRY_MS = 60_000;
export const REGISTRY_TIMEOUT_MS = 3_500;
export const REGISTRY_ATTEMPTS = 2;
export const DEFAULT_MODELS_REGISTRY_URL = "https://models.opencode.ai";
export const QUOTA_TTL_MS = 30_000;
export const QUOTA_HTTP_TIMEOUT_MS = 5_000;
export const QUOTA_REFRESH_DEBOUNCE_MS = 1_000;
export const SESSION_RESET_COOLDOWN_MS = 15_000;
/**
 * How long a free-pi session must stay quiet before its server slot is closed.
 * Background compaction can start right after the last step, so closing on the
 * execution event alone would race with it.
 */
export const SESSION_FINALIZE_DELAY_MS = 2_000;
export const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";
