/** Resolves (or creates) the ad turn for a session request. */
import { randomUUID } from "node:crypto";
import { adContextFor, latestAssistantText, latestUserMessageID, latestUserText, } from "./context.js";
import { adTurnKey, getAdTurn, rememberAdTurn } from "./turns.js";
/**
 * Uses the request messages for primary requests and the stored session for
 * auxiliary ones, where the request messages are synthetic (for example a
 * title prompt).
 */
async function contextMessages(deps, request) {
    const provided = request.messages ?? [];
    if (request.kind !== "title" && provided.length > 0)
        return provided;
    const stored = await deps.readContext(request.sessionID).catch(() => []);
    return stored.length > 0 ? stored : provided;
}
export async function resolveAdTurn(deps, request) {
    const messages = await contextMessages(deps, request);
    const messageID = latestUserMessageID(messages) ??
        latestUserMessageID(request.messages ?? []);
    const key = messageID
        ? adTurnKey(messageID, request.agent)
        : `${request.sessionID}\u0000${request.agent ?? ""}`;
    let turn = getAdTurn(deps, key);
    if (!turn) {
        turn = rememberAdTurn(deps, key, {
            turnId: randomUUID(),
            context: adContextFor(latestUserText(messages), latestAssistantText(messages)),
        });
    }
    else if (!turn.context) {
        turn.context = adContextFor(latestUserText(messages), latestAssistantText(messages));
    }
    return turn;
}
