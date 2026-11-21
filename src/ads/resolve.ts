/** Resolves (or creates) the ad turn for a session request. */

import { randomUUID } from "node:crypto";
import type { Deps } from "../deps.js";
import type { AdTurn } from "../types.js";
import {
  adContextFor,
  latestAssistantText,
  latestUserMessageID,
  latestUserText,
  type AdMessage,
} from "./context.js";
import { adTurnKey, getAdTurn, rememberAdTurn } from "./turns.js";

function userMessageCount(messages: readonly AdMessage[]): number {
  let count = 0;
  for (const message of messages) {
    const role = message.role ?? message.type;
    if (role === "user") count += 1;
  }
  return count;
}

/**
 * Stable, id-free turn fingerprint. Provider request messages usually carry the
 * stored user message id, but not always; without one the ad turn would never
 * rotate and the provider would keep answering with the same ad (or fail once
 * it expires). The user-message count plus the latest prompt changes exactly
 * when the user sends a new turn.
 */
function turnFingerprint(messages: readonly AdMessage[]): string {
  return `${userMessageCount(messages)}:${latestUserText(messages).slice(0, 160)}`;
}

export type AdTurnRequest = {
  readonly sessionID: string;
  readonly agent: string | undefined;
  readonly kind: string;
  readonly messages?: readonly AdMessage[];
};

/**
 * Uses the request messages for primary requests and the stored session for
 * auxiliary ones, where the request messages are synthetic (for example a
 * title prompt).
 */
async function contextMessages(
  deps: Deps,
  request: AdTurnRequest,
): Promise<readonly AdMessage[]> {
  const provided = request.messages ?? [];
  if (request.kind !== "title" && provided.length > 0) return provided;
  const stored = await deps.readContext(request.sessionID).catch(() => []);
  return stored.length > 0 ? stored : provided;
}

export async function resolveAdTurn(
  deps: Deps,
  request: AdTurnRequest,
): Promise<AdTurn> {
  let messages = await contextMessages(deps, request);
  let messageID = latestUserMessageID(messages);
  if (!messageID) {
    // The provider messages often omit ids; the stored session keeps them, so
    // use it to keep one ad per user turn instead of one per session.
    const stored = await deps.readContext(request.sessionID).catch(() => []);
    messageID = latestUserMessageID(stored);
    if (messages.length === 0 && stored.length > 0) messages = stored;
  }
  if (!messageID) {
    messageID = latestUserMessageID(request.messages ?? []);
  }
  const key = messageID
    ? adTurnKey(messageID, request.agent)
    : `${request.sessionID}\u0000${request.agent ?? ""}\u0000${turnFingerprint(messages)}`;

  let turn = getAdTurn(deps, key);
  if (!turn) {
    turn = rememberAdTurn(deps, key, {
      turnId: randomUUID(),
      context: adContextFor(latestUserText(messages), latestAssistantText(messages)),
    });
  } else if (!turn.context) {
    turn.context = adContextFor(
      latestUserText(messages),
      latestAssistantText(messages),
    );
  }
  return turn;
}
