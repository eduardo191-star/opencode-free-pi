/** The free-pi credential file written by the free-pi CLI. */
import type { Credentials } from "../types.js";
export declare function credentialsPath(): string;
export declare function credentialsDisplayPath(): string;
export declare function readCredentials(): Promise<Credentials | undefined>;
export declare function readCredentialsToken(): Promise<string | undefined>;
export declare function writeCredentials(token: string, issuer?: string): Promise<void>;
