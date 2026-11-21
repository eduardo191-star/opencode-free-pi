/** Per-turn ad bookkeeping keyed by user message and agent. */
import { AD_TURN_LIMIT } from "../constants.js";
import { trimMap } from "../utils/async.js";
export function adTurnKey(messageId, agent) {
    return agent ? `${messageId}\u0000${agent}` : messageId;
}
export function rememberAdTurn(deps, key, turn) {
    trimMap(deps.state.adTurns, AD_TURN_LIMIT);
    deps.state.adTurns.set(key, turn);
    return turn;
}
export function getAdTurn(deps, key) {
    return deps.state.adTurns.get(key);
}
