/** free-pi sign-in flows: browser connect and GitHub device code. */
import { AUTH_NETWORK_FAILURES, AUTH_TIMEOUT_MS, CONSENT_VERSION, } from "../constants.js";
import { sleep } from "../utils/async.js";
import { failureText, postJsonRetry } from "../utils/http.js";
import { readJson } from "../utils/json.js";
import { duplicateNumber } from "../utils/numbers.js";
import { cleanText } from "../utils/text.js";
import { safeUrl } from "../utils/urls.js";
export async function startConnect(clientVersion) {
    const response = await postJsonRetry("/auth/connect/start", {
        consent_version: CONSENT_VERSION,
        client: { os: process.platform, cli_version: clientVersion },
    }, { "x-freepi-signin-exp": "1" });
    const body = await readJson(response);
    if (!response.ok)
        throw new Error(failureText(response.status, body));
    const url = safeUrl(body?.connect_url);
    if (typeof body?.session_id !== "string" ||
        typeof body?.poll_secret !== "string" ||
        !url ||
        typeof body?.confirm_code !== "string") {
        throw new Error("free-pi returned an invalid browser sign-in response.");
    }
    return {
        session_id: body.session_id,
        poll_secret: body.poll_secret,
        token: typeof body.token === "string" ? body.token : undefined,
        confirm_code: cleanText(body.confirm_code),
        connect_url: url,
        expires_in: duplicateNumber(body.expires_in) ?? 900,
        interval: duplicateNumber(body.interval) ?? 5,
    };
}
export async function startDevice() {
    const response = await postJsonRetry("/auth/github/device", {});
    const body = await readJson(response);
    if (!response.ok)
        throw new Error(failureText(response.status, body));
    if (typeof body?.session_id !== "string" ||
        typeof body?.user_code !== "string" ||
        typeof body?.verification_uri !== "string") {
        throw new Error("free-pi returned an invalid GitHub device response.");
    }
    return {
        session_id: body.session_id,
        user_code: cleanText(body.user_code),
        verification_uri: body.verification_uri,
        verification_uri_complete: typeof body.verification_uri_complete === "string"
            ? body.verification_uri_complete
            : undefined,
        interval: duplicateNumber(body.interval) ?? 5,
        expires_in: duplicateNumber(body.expires_in) ?? 900,
    };
}
export async function submitConsent(sessionId) {
    const response = await postJsonRetry("/auth/consent", {
        session_id: sessionId,
        consent_version: CONSENT_VERSION,
    });
    if (!response.ok) {
        throw new Error(failureText(response.status, await readJson(response)));
    }
}
export async function pollForToken(request, interval, expiresIn) {
    let waitSeconds = Math.max(1, interval || 1);
    let networkFailures = 0;
    const deadline = Date.now() +
        Math.min(AUTH_TIMEOUT_MS, Math.max(1, expiresIn || 900) * 1000);
    while (Date.now() < deadline) {
        await sleep(waitSeconds * 1000);
        if (Date.now() >= deadline)
            break;
        let response;
        try {
            response = await request();
            networkFailures = 0;
        }
        catch {
            networkFailures += 1;
            if (networkFailures >= AUTH_NETWORK_FAILURES) {
                throw new Error("Can't reach free-pi. Check your internet connection and try again.");
            }
            waitSeconds = Math.max(waitSeconds, 5);
            continue;
        }
        const body = await readJson(response);
        if (!response.ok) {
            if (response.status === 403 && body?.code === "denied") {
                throw new Error("Sign-in was cancelled in the browser.");
            }
            if (response.status === 410 || body?.message === "expired_token") {
                throw new Error("GitHub sign-in timed out.");
            }
            if (response.status === 403 && body?.code === "consent_required") {
                throw new Error("free-pi did not record consent before polling.");
            }
            throw new Error(failureText(response.status, body));
        }
        if (typeof body?.token === "string" && body.token.length > 0)
            return body.token;
        const retryAfter = duplicateNumber(body?.retry_after);
        waitSeconds = retryAfter ?? Math.max(waitSeconds, 5);
    }
    throw new Error("GitHub sign-in timed out. Run the login again to retry.");
}
export function deviceUrl(session) {
    const complete = safeUrl(session.verification_uri_complete);
    if (complete)
        return complete;
    const base = safeUrl(session.verification_uri);
    if (!base)
        throw new Error("GitHub sign-in did not return a valid link.");
    const url = new URL(base);
    if (!url.searchParams.has("user_code"))
        url.searchParams.set("user_code", session.user_code);
    return url.toString();
}
