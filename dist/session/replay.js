/**
 * Transparently replays a free-pi request that hit the per-session
 * `429 concurrent` limit.
 *
 * OpenCode builds the provider request once and reuses it for every retry of a
 * step (`SessionRunner.runStep` calls `request.primary` outside the attempt
 * loop). Rotating `x-session-id` in the retry hook therefore cannot help the
 * failed attempt: the retried request still carries the old id. The server can
 * also leave a session slot locked after an aborted stream, which resets do not
 * clear.
 *
 * Replaying from `http.response` instead sends the same body with a fresh wire
 * session id and returns the good response to OpenCode, so the turn continues
 * without a visible "Retrying…" or a failed step.
 */
import { closeFreePiSession } from "../api/session.js";
import { sleep, trimMap } from "../utils/async.js";
import { rotateWireSessionID, wireSessionID } from "./wire.js";
const REPLAY_BODY_LIMIT = 24;
const REPLAY_MAX_ATTEMPTS = 4;
const REPLAY_BASE_DELAY_MS = 400;
const REPLAY_MAX_DELAY_MS = 3_000;
function requestKey(sessionID, request) {
    const turn = request.headers.get("x-turn-id") ?? "";
    return `${sessionID}\u0000${turn}\u0000${request.url}`;
}
function isJson(request) {
    return (request.headers.get("content-type") ?? "").includes("json");
}
/** Keeps the body around so a 429 can be replayed after fetch consumed it. */
export async function rememberReplayBody(deps, event) {
    const request = event?.request;
    if (!(request instanceof Request) || !isJson(request) || !event.sessionID)
        return;
    const key = requestKey(event.sessionID, request);
    try {
        const body = await request.clone().text();
        if (!body)
            return;
        deps.state.replayBodies.delete(key);
        deps.state.replayBodies.set(key, body);
        trimMap(deps.state.replayBodies, REPLAY_BODY_LIMIT);
    }
    catch {
        // A non-replayable body simply falls back to the normal retry hook.
    }
}
async function isConcurrent(response) {
    if (response.status !== 429)
        return false;
    const body = await response
        .clone()
        .text()
        .catch(() => "");
    return /"concurrent"/i.test(body) || /one request at a time/i.test(body);
}
function concurrentDelay(attempt) {
    return Math.min(REPLAY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), REPLAY_MAX_DELAY_MS);
}
/**
 * Returns a replacement response when a concurrent 429 was recovered, or
 * `undefined` to leave the original response untouched.
 */
export async function replayConcurrentResponse(deps, event) {
    const original = event?.response;
    const request = event?.request;
    if (!(original instanceof Response) || !(request instanceof Request))
        return;
    if (request.signal.aborted)
        return;
    if (!(await isConcurrent(original)))
        return;
    const body = deps.state.replayBodies.get(requestKey(event.sessionID, request)) ??
        (isJson(request)
            ? await request
                .clone()
                .text()
                .catch(() => undefined)
            : undefined);
    if (!body)
        return;
    let previous = request.headers.get("x-session-id") ??
        wireSessionID(deps, event.sessionID);
    for (let attempt = 1; attempt <= REPLAY_MAX_ATTEMPTS; attempt++) {
        if (request.signal.aborted)
            return;
        if (attempt > 1)
            await sleep(concurrentDelay(attempt));
        const next = rotateWireSessionID(deps, event.sessionID);
        if (previous && previous !== next) {
            void closeFreePiSession(deps, previous).catch(() => undefined);
        }
        previous = next;
        const headers = new Headers(request.headers);
        headers.set("x-session-id", next);
        headers.delete("content-length");
        headers.delete("host");
        const response = await fetch(request.url, {
            method: request.method,
            headers,
            body,
            signal: request.signal,
        }).catch(() => undefined);
        if (!response)
            continue;
        if (!(await isConcurrent(response))) {
            deps.log.info("free-pi session busy; replayed the request with a fresh session id", {
                sessionID: event.sessionID,
                from: request.headers.get("x-session-id") ?? undefined,
                to: next,
                attempt,
            });
            return response;
        }
    }
    return undefined;
}
