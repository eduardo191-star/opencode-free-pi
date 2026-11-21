/** Starts a free-pi sign-in and returns the V2 authorization payload. */
import type { Credential } from "@opencode/schema/credential";
import type { Logger } from "../logging.js";
export type FreePiAuthorization = {
    url: string;
    instructions: string;
    callback: Promise<Credential.OAuth>;
};
export type AuthorizeDeps = {
    log: Logger;
    clientVersion: string;
    warmCatalog?: () => Promise<unknown>;
};
export declare function authorizeFreePi(deps: AuthorizeDeps): Promise<FreePiAuthorization>;
