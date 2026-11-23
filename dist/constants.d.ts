/** Identifiers and defaults shared by every part of the plugin. */
export declare const PROVIDER_ID = "free-pi";
export declare const DEFENSE_PROVIDER_ID = "free-pi-defense";
export declare const INTEGRATION_ID = "free-pi";
export declare const PROVIDER_NAME = "Free Pi";
export declare const DEFENSE_PROVIDER_NAME = "Free Pi Defense";
export declare const DEFAULT_BASE_URL = "https://api.freepi.ai";
export declare const DEFAULT_CLIENT_VERSION = "0.6.25";
export declare const CONSENT_VERSION = "4";
/**
 * The provider CLI's window. The gateway enforces its own ceiling but does not
 * publish it, so this is the starting point; `verifyGatewayWindow` replaces it
 * with what the server actually accepts.
 */
export declare const CONTEXT_WINDOW = 200000;
/** Largest window the plugin will ever advertise after measuring the gateway. */
export declare const MAX_CONTEXT_WINDOW = 1000000;
export declare const MAX_OUTPUT_TOKENS = 32768;
/**
 * Upper bound for a model that publishes a larger output budget. Reasoning
 * tokens share this budget, so a model that can emit more must not be pinned to
 * the CLI's 32k: a long chain of thought would consume it and leave `content`
 * empty.
 */
export declare const MAX_OUTPUT_TOKENS_CEILING = 131072;
/** How long a measured gateway window is trusted before checking again. */
export declare const VERIFY_LIMITS_TTL_MS: number;
export declare const AD_CONTEXT_HEADER = "x-ad-context";
/**
 * The CLI sends `none` when the ad context is unavailable or private instead of
 * omitting the header; the server expects the explicit opt-out to rotate ads.
 */
export declare const AD_CONTEXT_OPT_OUT = "none";
export declare const SUBAGENT_HEADER = "x-freepi-subagent";
/**
 * The provider CLI starts with thinking off, but leaving `reasoning_effort`
 * unset makes the gateway answer in a hurry: the free models spend only a few
 * dozen reasoning tokens even on tasks that need planning. The gateway accepts
 * every level (measured with curl_cffi) but currently does not let the level
 * change how long the upstream thinks, so the plugin also asks for explicit
 * step-by-step checking in the prompt and defaults to `high`. `none`/`minimal`
 * stay one pick away when speed matters more than care.
 */
export declare const DEFAULT_REASONING_EFFORT = "high";
export declare const REASONING_EFFORTS: readonly ["none", "minimal", "low", "medium", "high", "max"];
export declare const DEFAULT_THINKING_LEVELS: readonly ["none", "minimal", "low", "medium", "high", "max"];
/**
 * Injected into every primary free-pi request. OpenCode already supplies the
 * coding instructions; this block covers the failure modes the weaker free
 * models show: skipping analysis, inventing verification, and ignoring the
 * context the conversation already established.
 */
export declare const FREE_PI_GUIDANCE = "# free-pi working rules\n- Answer the user's latest request and keep their constraints; do not switch to a different task.\n- Slow down on multi-step work (arithmetic, counting, logic, dates, units, planning, debugging): write out each step, recompute the result a second way, and only then answer. On those tasks a correct answer after a dozen explicit steps beats a fast guess; do not stop at the first plausible number.\n- Read the files involved before editing and run the project's checks afterwards. Never say a test, build or command passed unless you ran it and saw it pass.\n- Treat the conversation above as memory: reuse earlier decisions, file paths, identifiers and results. If something is genuinely missing, say what is missing instead of guessing.\n- Use the available tools (read, grep, glob, bash, edit) for real work; do not describe hypothetical commands as if they ran.\n- Delegate large or self-contained work with OpenCode's native `subagent` tool: `free-pi/scout` and `free-pi/planner` for read-only recon and planning, `free-pi/worker` for a full task, `free-pi/reviewer` for review. A subagent runs in its own context and reports back; never launch a subagent from inside one.\n- Load a skill with the native `skill` tool when its description matches the task.\n- `AGENTS.md` and the files listed under `instructions` are the project's memory. Follow them; do not restate or replace them.\n- Never claim to have compacted, summarized or cleared context unless that actually happened.\n- Continue until the request is finished, then report concisely what changed and what you verified.";
export declare const FREE_PI_GUIDANCE_MARKER = "# free-pi working rules";
/**
 * Appended to OpenCode's compaction request. Its default summary prompt asks
 * for terse checkpoints, which is fine for strong models but loses the exact
 * facts the free models need; spell out what must survive the rewrite.
 */
export declare const FREE_PI_COMPACTION_GUIDANCE = "# free-pi compaction rules\n- Keep every unresolved user requirement and constraint, using their wording when a later agent must act on them.\n- Keep decisions and their reasons, exact file paths and symbols, commands with the observed result, error strings, and work still pending.\n- Preserve details that explain why the current state looks the way it does; the next agent cannot re-read the history this summary replaces.\n- Do not invent progress or results that are not in the conversation.";
export declare const FREE_PI_COMPACTION_MARKER = "# free-pi compaction rules";
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
/** Tool outcome headers emitted by the free-pi provider CLI. */
export declare const TOOL_META_HEADER = "x-freepi-tool-meta";
export declare const TOOL_ERRORS_HEADER = "x-freepi-tool-errors";
export declare const COMPACTED_HEADER = "x-freepi-compacted";
export declare const TOOL_META_BUDGET = 1500;
export declare const TOOL_ID_LIMIT = 50;
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
export declare const CATALOG_TIMEOUT_MS = 8000;
export declare const REGISTRY_TTL_MS: number;
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
