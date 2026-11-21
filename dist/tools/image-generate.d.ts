/**
 * `generate_image`, the free-pi text-to-image tool.
 *
 * The models cannot see images, so the tool writes the server's image into
 * `images/` inside the project and returns the relative path. Same endpoint,
 * limits and error wording as the provider CLI.
 */
import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
export declare function slug(value: string): string;
export declare function registerGenerateImageTool(ctx: Plugin.Context, deps: Deps): Promise<{
    dispose: () => Promise<void>;
}>;
