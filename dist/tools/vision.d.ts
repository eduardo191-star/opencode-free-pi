/**
 * `look_at_image`, the free-pi vision tool.
 *
 * Image-capable free-pi models see attached images natively, but a file on disk
 * still has to be attached (and its pixels stay in the context). This tool asks
 * the server's vision model one question about the file and returns text only,
 * which also covers text-only models. Each call counts against the user's daily
 * allowance.
 */
import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
type Registration = {
    dispose: () => Promise<void>;
};
export declare function visionErrorText(code: string): string | undefined;
/**
 * Registers the tool globally. Execution is gated to free-pi sessions, so the
 * tool never spends free-pi allowance from another provider's session.
 */
export declare function registerVisionTool(ctx: Plugin.Context, deps: Deps): Promise<Registration>;
export {};
