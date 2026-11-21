/** Account quota fetching shared by error handling and usage tracking. */

import { resolveToken } from "../auth/token.js";
import { QUOTA_HTTP_TIMEOUT_MS, QUOTA_TTL_MS } from "../constants.js";
import type { Deps } from "../deps.js";
import { logInvalidToken } from "../errors/invalid.js";
import type {
  MeResponse,
  MeStatsResponse,
  QuotaSnapshot,
  TokenCheckState,
} from "../types.js";
import { trimMap } from "../utils/async.js";
import { readJson } from "../utils/json.js";
import { resolveBaseUrl } from "../utils/urls.js";

export function rememberTokenCheck(
  deps: Deps,
  token: string,
  state: TokenCheckState,
): void {
  trimMap(deps.state.tokenChecks, 100);
  deps.state.tokenChecks.set(token, { at: Date.now(), state });
}

export async function fetchQuota(
  deps: Deps,
  opts: { force?: boolean; stats?: boolean } = {},
): Promise<QuotaSnapshot> {
  const current = deps.state.quotaCache;
  if (
    !opts.force &&
    current &&
    Date.now() - current.fetchedAt < QUOTA_TTL_MS &&
    (!opts.stats || current.stats)
  ) {
    return current;
  }
  if (deps.state.quotaPromise) return deps.state.quotaPromise;

  const pending = (async () => {
    const token = await resolveToken(deps);
    if (!token) {
      const missing: QuotaSnapshot = {
        fetchedAt: Date.now(),
        error:
          "No free-pi sign-in found. Run `opencode auth login -p free-pi`.",
        tokenInvalid: true,
      };
      deps.state.quotaCache = missing;
      return missing;
    }
    const headers = { authorization: `Bearer ${token}` };
    const meRequest = fetch(new URL("/me", resolveBaseUrl()), {
      headers,
      signal: AbortSignal.timeout(QUOTA_HTTP_TIMEOUT_MS),
    }).catch(() => undefined);
    const statsRequest = opts.stats
      ? fetch(new URL("/me/stats", resolveBaseUrl()), {
          headers,
          signal: AbortSignal.timeout(QUOTA_HTTP_TIMEOUT_MS),
        }).catch(() => undefined)
      : Promise.resolve(undefined);
    const [meResponse, statsResponse] = await Promise.all([
      meRequest,
      statsRequest,
    ]);
    if (meResponse?.status === 401 || statsResponse?.status === 401) {
      rememberTokenCheck(deps, token, "invalid");
      await logInvalidToken(deps, token);
      const invalid: QuotaSnapshot = {
        fetchedAt: Date.now(),
        token,
        tokenInvalid: true,
        error:
          "free-pi sign-in is invalid or expired. Run `opencode auth login -p free-pi`.",
      };
      deps.state.quotaCache = invalid;
      return invalid;
    }
    const me = meResponse?.ok
      ? ((await readJson(meResponse)) as MeResponse | undefined)
      : undefined;
    const stats = statsResponse?.ok
      ? ((await readJson(statsResponse)) as MeStatsResponse | undefined)
      : undefined;
    if (meResponse?.ok || statsResponse?.ok)
      rememberTokenCheck(deps, token, "ok");
    const snapshot: QuotaSnapshot = {
      fetchedAt: Date.now(),
      token,
      me: me ?? current?.me,
      stats: stats ?? current?.stats,
      ...(meResponse
        ? meResponse.ok
          ? {}
          : { error: `free-pi /me returned HTTP ${meResponse.status}` }
        : { error: "Could not reach free-pi /me" }),
    };
    deps.state.quotaCache = snapshot;
    return snapshot;
  })();

  deps.state.quotaPromise = pending;
  try {
    return await pending;
  } finally {
    if (deps.state.quotaPromise === pending) deps.state.quotaPromise = undefined;
  }
}
