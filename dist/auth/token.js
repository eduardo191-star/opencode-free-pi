/** Resolves the token used for free-pi HTTP requests. */
import { readCredentials } from "./credentials.js";
import { expiryFromCredential, tokenFromCredential, } from "./credential.js";
import { tokenNeedsRefresh } from "./jwt.js";
/**
 * Prefers the active OpenCode credential. The free-pi CLI credential file is a
 * fallback for users who have not connected the integration yet.
 */
export async function resolveToken(source) {
    const credential = await source.activeCredential();
    const current = tokenFromCredential(credential);
    const stored = await readCredentials();
    if (current && !tokenNeedsRefresh(current, expiryFromCredential(credential)))
        return current;
    if (stored?.token &&
        stored.token !== current &&
        !tokenNeedsRefresh(stored.token)) {
        return stored.token;
    }
    if (current) {
        if (source.state.lastExpiredToken !== current) {
            source.state.lastExpiredToken = current;
            source.log.warn("free-pi token is expired. free-pi does not expose a refresh endpoint; sign in again from the free-pi integration.");
        }
        return current;
    }
    return stored?.token;
}
