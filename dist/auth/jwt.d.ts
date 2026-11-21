/** JWT and refresh-token encoding helpers. */
import type { Credentials, JwtClaims } from "../types.js";
export declare function parseJwtClaims(token: string): JwtClaims | undefined;
export declare function tokenExpiry(token: string): number | undefined;
export declare function tokenNeedsRefresh(token: string, expires?: number): boolean;
export declare function encodeRefreshToken(token: string, issuer?: string): string;
export declare function decodeRefreshToken(value: string | undefined): Credentials | undefined;
