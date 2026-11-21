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
export const COST_EXPERIMENT_HEADER = "x-freepi-cost-exp";
export const EFFICIENCY_RULE =
  "- When several independent reads or searches are needed, issue them in the same turn.";

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

export const OPENAI_COMPATIBLE_PACKAGE =
  "@opencode/ai/providers/openai-compatible";
