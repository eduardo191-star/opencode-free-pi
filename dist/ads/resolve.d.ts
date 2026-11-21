/** Resolves (or creates) the ad turn for a session request. */
import type { Deps } from "../deps.js";
import type { AdTurn } from "../types.js";
import { type AdMessage } from "./context.js";
export type AdTurnRequest = {
    readonly sessionID: string;
    readonly agent: string | undefined;
    readonly kind: string;
    readonly messages?: readonly AdMessage[];
};
export declare function resolveAdTurn(deps: Deps, request: AdTurnRequest): Promise<AdTurn>;
