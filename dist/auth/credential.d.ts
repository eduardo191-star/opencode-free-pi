/** Translates OpenCode V2 credentials into free-pi tokens. */
import type { Credential } from "@opencode/schema/credential";
export declare function tokenFromCredential(credential: Credential.Value | undefined): string | undefined;
export declare function expiryFromCredential(credential: Credential.Value | undefined): number | undefined;
export declare function issuerFromCredential(credential: Credential.Value | undefined): string | undefined;
