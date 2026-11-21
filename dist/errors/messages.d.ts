/** Human-readable copy for free-pi error codes. */
import type { FreePiError } from "../types.js";
export declare function freePiErrorTitle(error: FreePiError): string;
export declare function freePiErrorSeverity(error: FreePiError): "warn" | "error";
export declare function errorResetHint(error: FreePiError): string | undefined;
export declare function friendlyFreePiError(error: FreePiError): string;
