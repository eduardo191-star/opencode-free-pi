/** JWT and refresh-token encoding helpers. */

import {
  AUTH_SKEW_MS,
  REFRESH_PREFIX,
} from "../constants.js";
import type { Credentials, JwtClaims } from "../types.js";
import { normalizeIssuer } from "../utils/urls.js";

export function parseJwtClaims(token: string): JwtClaims | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return parsed && typeof parsed === "object"
      ? (parsed as JwtClaims)
      : undefined;
  } catch {
    return undefined;
  }
}

export function tokenExpiry(token: string): number | undefined {
  const exp = parseJwtClaims(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) && exp > 0
    ? exp * 1000
    : undefined;
}

export function tokenNeedsRefresh(token: string, expires?: number): boolean {
  const now = Date.now();
  const jwtExpiry = tokenExpiry(token);
  return (
    (jwtExpiry !== undefined && jwtExpiry - now <= AUTH_SKEW_MS) ||
    (typeof expires === "number" &&
      expires > 0 &&
      expires - now <= AUTH_SKEW_MS)
  );
}

export function encodeRefreshToken(token: string, issuer?: string): string {
  const payload = JSON.stringify(issuer ? { token, issuer } : { token });
  return `${REFRESH_PREFIX}${Buffer.from(payload).toString("base64url")}`;
}

export function decodeRefreshToken(
  value: string | undefined,
): Credentials | undefined {
  if (!value) return undefined;
  if (value.startsWith(REFRESH_PREFIX)) {
    try {
      const parsed = JSON.parse(
        Buffer.from(value.slice(REFRESH_PREFIX.length), "base64url").toString(
          "utf8",
        ),
      ) as { token?: unknown; issuer?: unknown };
      if (typeof parsed.token === "string" && parsed.token.length > 0) {
        const issuer = normalizeIssuer(parsed.issuer);
        return issuer
          ? { token: parsed.token, issuer }
          : { token: parsed.token };
      }
    } catch {}
  }
  try {
    const parsed = JSON.parse(value) as { token?: unknown; issuer?: unknown };
    if (typeof parsed.token === "string" && parsed.token.length > 0) {
      const issuer = normalizeIssuer(parsed.issuer);
      return issuer ? { token: parsed.token, issuer } : { token: parsed.token };
    }
  } catch {}
  return { token: value };
}
