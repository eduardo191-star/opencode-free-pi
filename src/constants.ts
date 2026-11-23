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
/** Largest window the plugin will ever advertise after measuring the gateway. */
export const MAX_CONTEXT_WINDOW = 1_000_000;
export const MAX_OUTPUT_TOKENS = 32_768;
/**
 * Share of the advertised window a primary request may occupy before stale
 * tool results are collapsed. Long free-pi sessions reach 100k-170k prompts
 * and the free models then lose the middle of the conversation and stop
 * following the working rules, even though the gateway still accepts them.
 */
export const CONTEXT_DIET_SHARE = 0.4;
/** Below this window the diet is pointless: the request is small anyway. */
export const CONTEXT_DIET_MIN_TOKENS = 24_000;
/**
 * Upper bound for a model that publishes a larger output budget. Reasoning
 * tokens share this budget, so a model that can emit more must not be pinned to
 * the CLI's 32k: a long chain of thought would consume it and leave `content`
 * empty.
 */
export const MAX_OUTPUT_TOKENS_CEILING = 131_072;
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
 * dozen reasoning tokens even on tasks that need planning. The gateway accepts
 * every level (measured with curl_cffi) but currently does not let the level
 * change how long the upstream thinks, so the plugin also asks for explicit
 * step-by-step checking in the prompt and defaults to `high`. `none`/`minimal`
 * stay one pick away when speed matters more than care.
 */
export const DEFAULT_REASONING_EFFORT = "high";
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "max",
] as const;
export const DEFAULT_THINKING_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "max",
] as const;

/**
 * Injected into every primary free-pi request. OpenCode already supplies the
 * coding instructions; this block covers the failure modes the weaker free
 * models show: skipping analysis, inventing verification, and ignoring the
 * context the conversation already established.
 */
export const FREE_PI_GUIDANCE = `# free-pi working rules
- Answer the user's latest request and keep their constraints; do not switch to a different task.
- Slow down on multi-step work (arithmetic, counting, logic, dates, units, planning, debugging): write out each step, recompute the result a second way, and only then answer. On those tasks a correct answer after a dozen explicit steps beats a fast guess; do not stop at the first plausible number.
- Read the files involved before editing and run the project's checks afterwards. Never say a test, build or command passed unless you ran it and saw it pass. In \`edit\`, \`oldString\` must differ from \`newString\` and match exactly once; add surrounding lines when it is ambiguous.
- Treat the conversation above as memory: reuse earlier decisions, file paths, identifiers and results. If something is genuinely missing, say what is missing instead of guessing.
- Use the available tools (\`read\`, \`grep\`, \`glob\`, \`shell\`, \`edit\`) for real work; do not describe hypothetical commands as if they ran. Prefer \`read\`, \`grep\` and \`glob\` over shell for inspecting files.
- The \`shell\` tool runs a portable scanner, not a full bash. Heredocs (\`<<EOF\`), chained one-liners with nested or heavy-escaped quotes, and some shells' loops are rejected before they run. Put any complex script in a file with \`write\` and run that file. On Windows the shell is PowerShell: use \`Get-ChildItem\`/\`Select-String\`, not \`dir /b\`, \`findstr\` or \`cmd /c\`.
- Reply in the language of the user's latest message; keep code, paths and identifiers unchanged.
- Delegate large or self-contained work with OpenCode's native \`subagent\` tool: \`free-pi/scout\` and \`free-pi/planner\` for read-only recon and planning, \`free-pi/worker\` for a full task, \`free-pi/reviewer\` for review. A subagent runs in its own context and reports back; never launch a subagent from inside one. The \`subagent\` tool returns a child \`sessionID\` and OpenCode injects the child's report when it goes idle; to inspect what that child actually did, call \`free_pi_subagent_read\` with its \`sessionID\` (omit it to list this session's children).
- Load a skill with the native \`skill\` tool when its description matches the task.
- \`AGENTS.md\` and the files listed under \`instructions\` are the project's memory. Follow them; do not restate or replace them.
- Never claim to have compacted, summarized or cleared context unless that actually happened.
- Never answer with a session summary or with \`## Objective\` / \`## Work State\` blocks; that format belongs to compaction. If the work is unfinished, take the next concrete action instead of describing the state.
- Continue until the request is finished, then report concisely what changed and what you verified.`;
export const FREE_PI_GUIDANCE_MARKER = "# free-pi working rules";

/**
 * Appended to OpenCode's compaction request. Its default summary prompt asks
 * for terse checkpoints, which is fine for strong models but loses the exact
 * facts the free models need; spell out what must survive the rewrite.
 */
export const FREE_PI_COMPACTION_GUIDANCE = `# free-pi compaction rules
- Keep every unresolved user requirement and constraint, using their wording when a later agent must act on them.
- For each step in the work state, write the conclusion it proved, not only the file or command: "read X and confirmed Y", "build failed with Z". A list of actions without their findings makes the next agent repeat the work.
- Keep decisions and their reasons, exact file paths and symbols, commands with the observed result, error strings, and work still pending.
- Preserve details that explain why the current state looks the way it does; the next agent cannot re-read the history this summary replaces.
- Do not invent progress or results that are not in the conversation.`;
export const FREE_PI_COMPACTION_MARKER = "# free-pi compaction rules";

/**
 * Repeats the two rules the free models break when the prompt is long: they
 * stop to describe the session state instead of acting, and they answer a
 * request to search from memory. It is sent as the last message of a primary
 * request because the free models read that position, while rules buried in a
 * 100k-token system prompt are easy to ignore. It is not a user instruction and
 * never becomes part of the stored conversation.
 */
export const TURN_REMINDER = `# free-pi turn check (not a user request)
You are in a normal working turn, not a compaction.
- Never answer with \`## Objective\`, \`## Requirements\`, \`## Work State\` or a session summary; that format belongs only to a compaction. Earlier sections with those names are history, not an answer template.
- If the user asked to search, find, analyze or verify something, call the matching tool first (grep/glob/shell for files, websearch/webfetch for the web) and report what it returned.
- Keep each shell command simple: no heredocs, no nested-quote one-liners, and PowerShell cmdlets on Windows. Write a script file and run it when the command is complex.
- If the task is unfinished, call the next tool now instead of describing the state.`;
export const TURN_REMINDER_MARKER = "# free-pi turn check";

/**
 * OpenCode keeps only the latest exchange beside a summary, so after a
 * compaction the turns that mattered a minute ago disappear unless the summary
 * carries them. The plugin reads the session from the native API and echoes the
 * newest turns into the summarizer request, so the summary can reproduce them.
 */
export const RECENT_WINDOW_MARKER = "# free-pi recent window";
/** Characters of the newest turns quoted back into the summary request. */
export const RECENT_WINDOW_CHARS = 24_000;
/** Messages read from the tail of the session to build that window. */
export const RECENT_WINDOW_MESSAGES = 120;
/**
 * The same window rides along on the first request after a compaction, in case
 * the summary compressed it away. It is quoted once and expires, so it never
 * becomes a second, permanent history.
 */
export const RECENT_WINDOW_CARRY_MARKER = "# free-pi carried window";
export const RECENT_WINDOW_CARRY_MS = 60 * 60_000;

/** pi-ai's HTTP idle timeout for headers and body chunks. */
export const HEADER_TIMEOUT_MS = 300_000;
export const CHUNK_TIMEOUT_MS = 300_000;

/** pi's retry policy: 3 retries, 2s base, 60s cap. */
export const RETRY_MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 2_000;
export const RETRY_MAX_DELAY_MS = 60_000;

/**
 * Transport failures (a refused or dropped connection, DNS blips) usually
 * clear on their own. OpenCode stops after its own retries, which can end a
 * turn during a brief local network or service restart, so the plugin gives
 * them a longer budget before giving up.
 */
export const TRANSPORT_RETRY_MAX = 5;
export const TRANSPORT_RETRY_BASE_MS = 2_000;
export const TRANSPORT_RETRY_MAX_DELAY_MS = 30_000;

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
export const CATALOG_ATTEMPTS = 2;
export const CATALOG_RETRY_MS = 1_000;
/**
 * When the catalog cannot be fetched, the provider is registered with no models
 * and the model picker loses every free-pi entry for that location. These are
 * the delays before each background attempt to fetch it again and re-register
 * the models, so a transient timeout heals without restarting OpenCode.
 */
export const CATALOG_RECOVERY_DELAYS_MS = [
  2_000, 5_000, 10_000, 20_000, 30_000, 60_000,
] as const;
/**
 * Once the burst above is exhausted, keep trying at this interval for as long
 * as no model is registered. A cold start during a long outage (VPN down, DPI
 * blocking the gateway) otherwise leaves the provider with zero models, and
 * OpenCode answers every free-pi prompt with "Model unavailable … not available
 * in this session's location" until the app is restarted.
 */
export const CATALOG_RECOVERY_INTERVAL_MS = 60_000;
/** Log one warning every N background attempts instead of one per minute. */
export const CATALOG_RECOVERY_LOG_EVERY = 10;
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
 * Releasing a server slot is a tiny POST, but a VPN or a proxy adds a round
 * trip; 3s let the reset expire before the gateway answered and left the slot
 * locked until the next 429.
 */
export const SESSION_RESET_TIMEOUT_MS = 6_000;

/**
 * How long a free-pi session must stay quiet before its server slot is closed.
 * Background compaction can start right after the last step, so closing on the
 * execution event alone would race with it.
 */
export const SESSION_FINALIZE_DELAY_MS = 2_000;

export const OPENAI_COMPATIBLE_PACKAGE =
  "@opencode/ai/providers/openai-compatible";
