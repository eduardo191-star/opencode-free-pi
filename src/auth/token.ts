/** Resolves the token used for free-pi HTTP requests. */

import type { Credential } from "@opencode/schema/credential";
import type { Logger } from "../logging.js";
import type { RuntimeState } from "../state.js";
import { readCredentials } from "./credentials.js";
import {
  expiryFromCredential,
  tokenFromCredential,
} from "./credential.js";
import { tokenNeedsRefresh } from "./jwt.js";

export type TokenSource = {
  readonly state: RuntimeState;
  readonly log: Logger;
  activeCredential: () => Promise<Credential.Value | undefined>;
};

/**
 * Prefers the active OpenCode credential. The free-pi CLI credential file is a
 * fallback for users who have not connected the integration yet.
 */
export async function resolveToken(
  source: TokenSource,
): Promise<string | undefined> {
  const credential = await source.activeCredential();
  const current = tokenFromCredential(credential);
  const stored = await readCredentials();

  if (current && !tokenNeedsRefresh(current, expiryFromCredential(credential)))
    return current;

  if (
    stored?.token &&
    stored.token !== current &&
    !tokenNeedsRefresh(stored.token)
  ) {
    return stored.token;
  }

  if (current) {
    if (source.state.lastExpiredToken !== current) {
      source.state.lastExpiredToken = current;
      source.log.warn(
        "free-pi token is expired. free-pi does not expose a refresh endpoint; sign in again from the free-pi integration.",
      );
    }
    return current;
  }

  return stored?.token;
}
