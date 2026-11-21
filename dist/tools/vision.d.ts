/**
 * `look_at_image`, the free-pi vision tool.
 *
 * free-pi models are text-only, exactly like the provider CLI. To inspect an
 * image the model asks this tool a question; the plugin posts the pixels to
 * `/tools/vision` and returns the vision model's text answer. Each call counts
 * against the user's daily allowance.
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
