/** Per-turn ad bookkeeping keyed by user message and agent. */

import { AD_TURN_LIMIT } from "../constants.js";
import type { Deps } from "../deps.js";
import type { AdTurn } from "../types.js";
import { trimMap } from "../utils/async.js";

export function adTurnKey(messageId: string, agent: string | undefined): string {
  return agent ? `${messageId}\u0000${agent}` : messageId;
}

export function rememberAdTurn(
  deps: Deps,
  key: string,
  turn: AdTurn,
): AdTurn {
  trimMap(deps.state.adTurns, AD_TURN_LIMIT);
  deps.state.adTurns.set(key, turn);
  return turn;
}

export function getAdTurn(deps: Deps, key: string): AdTurn | undefined {
  return deps.state.adTurns.get(key);
}
