/** Warns once when the stored free-pi credential is rejected. */

import type { Deps } from "../deps.js";

export async function logInvalidToken(
  deps: Deps,
  token?: string,
): Promise<void> {
  const key = token ?? "(none)";
  if (deps.state.lastInvalidToken === key) return;
  deps.state.lastInvalidToken = key;
  deps.log.warn(
    "free-pi sign-in is invalid or expired. Run `opencode auth login -p free-pi` to sign in again.",
  );
}
