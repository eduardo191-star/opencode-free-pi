/**
 * Diagnostic dump of what the plugin actually sends to free-pi.
 *
 * Enabled with `FREE_PI_TRACE=1`. It answers the questions the TUI and the
 * session database cannot: whether the tools travel complete, whether the
 * provider request keeps older reasoning, and whether the per-turn reminder is
 * the last message OpenCode sends. It never runs unless the env var is set.
 */
import type { Deps } from "../deps.js";
export declare function traceRequestBody(deps: Deps, sessionID: string, body: string): void;
