/** Per-turn ad bookkeeping keyed by user message and agent. */
import type { Deps } from "../deps.js";
import type { AdTurn } from "../types.js";
export declare function adTurnKey(messageId: string, agent: string | undefined): string;
export declare function rememberAdTurn(deps: Deps, key: string, turn: AdTurn): AdTurn;
export declare function getAdTurn(deps: Deps, key: string): AdTurn | undefined;
