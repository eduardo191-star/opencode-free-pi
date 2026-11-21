/** Warns once when the stored free-pi credential is rejected. */
import type { Deps } from "../deps.js";
export declare function logInvalidToken(deps: Deps, token?: string): Promise<void>;
