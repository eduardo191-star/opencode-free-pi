/** Fetches an ad for a turn and records its impression. */
import { AD_CONTEXT_HEADER, AD_IMPRESSION_LIMIT, AD_IMPRESSION_TIMEOUT_MS, AD_REQUEST_TIMEOUT_MS, } from "../constants.js";
import { trimMap } from "../utils/async.js";
import { adClientHeaders } from "../utils/device.js";
import { readJson } from "../utils/json.js";
import { resolveBaseUrl, safeUrl } from "../utils/urls.js";
export function fireGravityImpression(ad) {
    const target = ad?.source === "gravity" ? safeUrl(ad.imp_url) : undefined;
    if (!target)
        return false;
    try {
        fetch(target, {
            method: "GET",
            signal: AbortSignal.timeout(AD_IMPRESSION_TIMEOUT_MS),
        }).catch(() => undefined);
    }
    catch { }
    return true;
}
export function postAdImpression(deps, token, sessionId, ad) {
    const adId = typeof ad?.ad_id === "string" ? ad.ad_id : "";
    const clickToken = typeof ad?.click_token === "string" ? ad.click_token : "";
    if (!adId || !clickToken)
        return Promise.resolve();
    const existing = deps.state.adImpressions.get(clickToken);
    if (existing)
        return existing;
    const promise = (async () => {
        try {
            const impFired = fireGravityImpression(ad);
            const response = await fetch(`${resolveBaseUrl()}/ads/impression`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                    "x-session-id": sessionId,
                },
                body: JSON.stringify({
                    ad_id: adId,
                    click_token: clickToken,
                    ...(impFired ? { imp_fired: true } : {}),
                }),
                signal: AbortSignal.timeout(AD_IMPRESSION_TIMEOUT_MS),
            }).catch(() => undefined);
            if (!response?.ok)
                deps.state.adImpressions.delete(clickToken);
        }
        catch {
            deps.state.adImpressions.delete(clickToken);
        }
    })();
    trimMap(deps.state.adImpressions, AD_IMPRESSION_LIMIT);
    deps.state.adImpressions.set(clickToken, promise);
    return promise;
}
export async function fetchAdAndPostImpression(deps, token, sessionId, turn) {
    try {
        const headers = {
            authorization: `Bearer ${token}`,
            "x-session-id": sessionId,
            "x-client-version": deps.state.latestClientVersion,
            "x-turn-id": turn.turnId,
            "x-ad-trigger": "user_message",
            ...adClientHeaders(),
            ...(turn.context ? { [AD_CONTEXT_HEADER]: turn.context } : {}),
        };
        const response = await fetch(`${resolveBaseUrl()}/ads/next?slot=banner`, {
            headers,
            signal: AbortSignal.timeout(AD_REQUEST_TIMEOUT_MS),
        }).catch(() => undefined);
        if (!response?.ok || response.status === 204)
            return;
        const ad = await readJson(response);
        if (!ad)
            return;
        await postAdImpression(deps, token, sessionId, ad);
    }
    catch { }
}
export function ensureAdImpression(deps, token, sessionId, turn) {
    if (!turn.impression) {
        turn.impression = fetchAdAndPostImpression(deps, token, sessionId, turn).catch(() => undefined);
    }
    return turn.impression;
}
