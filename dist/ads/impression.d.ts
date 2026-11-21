/** Fetches an ad for a turn and records its impression. */
import type { Deps } from "../deps.js";
import type { AdTurn } from "../types.js";
export declare function fireGravityImpression(ad: any): boolean;
export declare function postAdImpression(deps: Deps, token: string, sessionId: string, ad: any): Promise<void>;
export declare function fetchAdAndPostImpression(deps: Deps, token: string, sessionId: string, turn: AdTurn): Promise<void>;
export declare function ensureAdImpression(deps: Deps, token: string, sessionId: string, turn: AdTurn): Promise<void>;
