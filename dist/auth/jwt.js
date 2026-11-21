/** JWT and refresh-token encoding helpers. */
import { AUTH_SKEW_MS, REFRESH_PREFIX, } from "../constants.js";
import { normalizeIssuer } from "../utils/urls.js";
export function parseJwtClaims(token) {
    const payload = token.split(".")[1];
    if (!payload)
        return undefined;
    try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return parsed && typeof parsed === "object"
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
export function tokenExpiry(token) {
    const exp = parseJwtClaims(token)?.exp;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0
        ? exp * 1000
        : undefined;
}
export function tokenNeedsRefresh(token, expires) {
    const now = Date.now();
    const jwtExpiry = tokenExpiry(token);
    return ((jwtExpiry !== undefined && jwtExpiry - now <= AUTH_SKEW_MS) ||
        (typeof expires === "number" &&
            expires > 0 &&
            expires - now <= AUTH_SKEW_MS));
}
export function encodeRefreshToken(token, issuer) {
    const payload = JSON.stringify(issuer ? { token, issuer } : { token });
    return `${REFRESH_PREFIX}${Buffer.from(payload).toString("base64url")}`;
}
export function decodeRefreshToken(value) {
    if (!value)
        return undefined;
    if (value.startsWith(REFRESH_PREFIX)) {
        try {
            const parsed = JSON.parse(Buffer.from(value.slice(REFRESH_PREFIX.length), "base64url").toString("utf8"));
            if (typeof parsed.token === "string" && parsed.token.length > 0) {
                const issuer = normalizeIssuer(parsed.issuer);
                return issuer
                    ? { token: parsed.token, issuer }
                    : { token: parsed.token };
            }
        }
        catch { }
    }
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed.token === "string" && parsed.token.length > 0) {
            const issuer = normalizeIssuer(parsed.issuer);
            return issuer ? { token: parsed.token, issuer } : { token: parsed.token };
        }
    }
    catch { }
    return { token: value };
}
