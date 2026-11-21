/** Starts a free-pi sign-in and returns the V2 authorization payload. */
import { DEFAULT_TOKEN_LIFETIME_MS, } from "../constants.js";
import { browserAvailable, openBrowser, } from "../utils/browser.js";
import { deviceReport } from "../utils/device.js";
import { postJson } from "../utils/http.js";
import { resolveBaseUrl } from "../utils/urls.js";
import { deviceUrl, pollForToken, startConnect, startDevice, submitConsent, } from "./connect.js";
import { writeCredentials } from "./credentials.js";
import { encodeRefreshToken, tokenExpiry } from "./jwt.js";
function oauthCredential(token, issuer) {
    return {
        type: "oauth",
        methodID: "github",
        refresh: encodeRefreshToken(token, issuer),
        access: token,
        expires: tokenExpiry(token) ?? Date.now() + DEFAULT_TOKEN_LIFETIME_MS,
    };
}
export async function authorizeFreePi(deps) {
    await deps.warmCatalog?.().catch(() => undefined);
    const base = resolveBaseUrl();
    if (browserAvailable()) {
        try {
            const session = await startConnect(deps.clientVersion);
            const opened = await openBrowser(session.connect_url);
            return {
                url: session.connect_url,
                instructions: `${opened ? "Browser opened." : "Open the URL below."} Confirm code ${session.confirm_code} in your browser, then approve the connection.`,
                callback: (async () => {
                    const token = await pollForToken(() => postJson("/auth/connect/poll", {
                        session_id: session.session_id,
                        poll_secret: session.poll_secret,
                        ...deviceReport(),
                    }), session.interval, session.expires_in);
                    await writeCredentials(token, base).catch(() => undefined);
                    return oauthCredential(token, base);
                })(),
            };
        }
        catch (error) {
            deps.log.warn("Browser sign-in could not start; falling back to GitHub device code.", { error: error instanceof Error ? error.message : String(error) });
        }
    }
    const session = await startDevice();
    const url = deviceUrl(session);
    const opened = await openBrowser(url);
    return {
        url,
        instructions: `${opened ? "Browser opened." : "Open the URL below."} Enter code ${session.user_code} on GitHub, then approve the connection.`,
        callback: (async () => {
            await submitConsent(session.session_id);
            const token = await pollForToken(() => postJson("/auth/token", {
                session_id: session.session_id,
                ...deviceReport(),
            }), session.interval, session.expires_in ?? 900);
            await writeCredentials(token, base).catch(() => undefined);
            return oauthCredential(token, base);
        })(),
    };
}
