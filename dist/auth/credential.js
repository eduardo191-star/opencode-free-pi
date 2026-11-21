/** Translates OpenCode V2 credentials into free-pi tokens. */
import { decodeRefreshToken, tokenExpiry } from "./jwt.js";
import { normalizeIssuer } from "../utils/urls.js";
export function tokenFromCredential(credential) {
    if (!credential)
        return undefined;
    if (credential.type === "oauth")
        return credential.access;
    if (credential.type === "key")
        return credential.key;
    return undefined;
}
export function expiryFromCredential(credential) {
    if (!credential)
        return undefined;
    if (credential.type === "oauth" && credential.expires > 0)
        return credential.expires;
    if (credential.type === "key" && credential.metadata?.expires) {
        const parsed = Number(credential.metadata.expires);
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
    }
    const token = tokenFromCredential(credential);
    return token ? tokenExpiry(token) : undefined;
}
export function issuerFromCredential(credential) {
    if (!credential)
        return undefined;
    if (credential.type === "oauth")
        return decodeRefreshToken(credential.refresh)?.issuer;
    if (credential.type === "key")
        return normalizeIssuer(credential.metadata?.issuer);
    return undefined;
}
