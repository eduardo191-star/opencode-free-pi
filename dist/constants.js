/** Identifiers and defaults shared by every part of the plugin. */
export const PROVIDER_ID = "free-pi";
export const DEFENSE_PROVIDER_ID = "free-pi-defense";
export const INTEGRATION_ID = PROVIDER_ID;
export const PROVIDER_NAME = "Free Pi";
export const DEFENSE_PROVIDER_NAME = "Free Pi Defense";
export const DEFAULT_BASE_URL = "https://api.freepi.ai";
export const DEFAULT_CLIENT_VERSION = "0.6.25";
export const CONSENT_VERSION = "4";
/**
 * The provider CLI's window. The gateway enforces its own ceiling but does not
 * publish it, so this is the starting point; `verifyGatewayWindow` replaces it
 * with what the server actually accepts.
 */
export const CONTEXT_WINDOW = 200_000;
export const MAX_OUTPUT_TOKENS = 32_768;
/** How long a measured gateway window is trusted before checking again. */
export const VERIFY_LIMITS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const AD_CONTEXT_HEADER = "x-ad-context";
/**
 * The CLI sends `none` when the ad context is unavailable or private instead of
 * omitting the header; the server expects the explicit opt-out to rotate ads.
 */
export const AD_CONTEXT_OPT_OUT = "none";
export const SUBAGENT_HEADER = "x-freepi-subagent";
/**
 * The provider CLI starts with thinking off, but leaving `reasoning_effort`
 * unset makes the gateway answer in a hurry: the free models spend only a few
 * dozen reasoning tokens even on tasks that need planning. The plugin therefore
 * asks for `medium` by default and keeps the CLI's levels as variants, so
 * `none`/`minimal` are still one pick away when speed matters more than care.
 */
export const DEFAULT_REASONING_EFFORT = "medium";
export const REASONING_EFFORTS = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "max",
];
export const DEFAULT_THINKING_LEVELS = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
];
/**
 * Injected into every primary free-pi request. OpenCode already supplies the
 * coding instructions; this block covers the failure modes the weaker free
 * models show: skipping analysis, inventing verification, and ignoring the
 * context the conversation already established.
 */
export const FREE_PI_GUIDANCE = `# free-pi working rules
- Answer the user's latest request and keep their constraints; do not switch to a different task.
- Read the files involved before editing and run the project's checks afterwards. Never say a test, build or command passed unless you ran it and saw it pass.
- Treat the conversation above as memory: reuse earlier decisions, file paths, identifiers and results. If something is genuinely missing, say what is missing instead of guessing.
- Use the available tools (read, grep, glob, bash, edit) for real work; do not describe hypothetical commands as if they ran.
- Never claim to have compacted, summarized or cleared context unless that actually happened.
- Continue until the request is finished, then report concisely what changed and what you verified.`;
export const FREE_PI_GUIDANCE_MARKER = "# free-pi working rules";
/**
 * Appended to OpenCode's compaction request. Its default summary prompt asks
 * for terse checkpoints, which is fine for strong models but loses the exact
 * facts the free models need; spell out what must survive the rewrite.
 */
export const FREE_PI_COMPACTION_GUIDANCE = `# free-pi compaction rules
- Keep every unresolved user requirement and constraint, using their wording when a later agent must act on them.
- Keep decisions and their reasons, exact file paths and symbols, commands with the observed result, error strings, and work still pending.
- Preserve details that explain why the current state looks the way it does; the next agent cannot re-read the history this summary replaces.
- Do not invent progress or results that are not in the conversation.`;
export const FREE_PI_COMPACTION_MARKER = "# free-pi compaction rules";
/** pi-ai's HTTP idle timeout for headers and body chunks. */
export const HEADER_TIMEOUT_MS = 300_000;
export const CHUNK_TIMEOUT_MS = 300_000;
/** pi's retry policy: 3 retries, 2s base, 60s cap. */
export const RETRY_MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 2_000;
export const RETRY_MAX_DELAY_MS = 60_000;
/**
 * free-pi allows one in-flight request per `x-session-id` and answers a second
 * one with `429 concurrent`. OpenCode does not retry that itself, and a slot
 * can leak server-side, so the plugin rotates the wire session id and retries.
 */
export const CONCURRENT_RETRY_MAX = 6;
export const CONCURRENT_RETRY_BASE_MS = 1_000;
export const CONCURRENT_RETRY_MAX_DELAY_MS = 15_000;
/** Tool outcome headers emitted by the free-pi provider CLI. */
export const TOOL_META_HEADER = "x-freepi-tool-meta";
export const TOOL_ERRORS_HEADER = "x-freepi-tool-errors";
export const COMPACTED_HEADER = "x-freepi-compacted";
export const TOOL_META_BUDGET = 1_500;
export const TOOL_ID_LIMIT = 50;
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
export const CATALOG_TIMEOUT_MS = 8_000;
export const REGISTRY_TTL_MS = 5 * 60_000;
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
