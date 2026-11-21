/** Extracts a structured free-pi error from provider or session errors. */
import type { FreePiError } from "../types.js";
export declare function parseRawFreePiError(error: any): FreePiError | undefined;
export declare function parseFreePiError(error: any, allowRaw?: boolean): FreePiError | undefined;
