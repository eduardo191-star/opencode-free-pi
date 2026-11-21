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
export declare const COST_EXPERIMENT_HEADER = "x-freepi-cost-exp";
export declare const EFFICIENCY_RULE = "- When several independent reads or searches are needed, issue them in the same turn.";
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
