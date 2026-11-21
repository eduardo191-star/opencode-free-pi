/** Resolves the token used for free-pi HTTP requests. */
import type { Credential } from "@opencode/schema/credential";
import type { Logger } from "../logging.js";
import type { RuntimeState } from "../state.js";
export type TokenSource = {
    readonly state: RuntimeState;
    readonly log: Logger;
    activeCredential: () => Promise<Credential.Value | undefined>;
};
/**
 * Prefers the active OpenCode credential. The free-pi CLI credential file is a
 * fallback for users who have not connected the integration yet.
 */
export declare function resolveToken(source: TokenSource): Promise<string | undefined>;
