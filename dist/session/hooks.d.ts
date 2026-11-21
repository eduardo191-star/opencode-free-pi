/** Registers the session hooks used by the free-pi providers. */
import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
type Registration = {
    dispose: () => Promise<void>;
};
export declare function registerSessionHooks(ctx: Plugin.Context, deps: Deps): Promise<Registration[]>;
export {};
