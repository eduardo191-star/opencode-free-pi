/**
 * Live limits and capabilities.
 *
 * free-pi's HTTP API never publishes per-model limits: `/client-version` only
 * carries id/name/free/section/note/stats_id, `/me` carries the quota, and chat
 * responses carry usage but no window. The gateway does enforce a real ceiling,
 * so the plugin verifies the advertised window against the gateway itself and
 * remembers what it learned. The measured value replaces the compiled default
 * on the next start; a probe failure leaves the previous value untouched.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveToken } from "../auth/token.js";
import { CONTEXT_WINDOW, VERIFY_LIMITS_TTL_MS, } from "../constants.js";
import { dataPath } from "../utils/data-dir.js";
import { completionsBaseUrl } from "../utils/urls.js";
const FILE = "live-limits.json";
const WRITE_DEBOUNCE_MS = 2_000;
/** Verification stops shrinking here instead of advertising a useless window. */
const MIN_WINDOW = 32_768;
let cached;
let loaded = false;
let writeTimer;
function emptyLimits() {
    return { version: 1, models: {} };
}
function sanitize(value) {
    if (!value || typeof value !== "object")
        return emptyLimits();
    const limits = value;
    const models = {};
    for (const [id, entry] of Object.entries(limits.models ?? {})) {
        if (!entry || typeof entry !== "object")
            continue;
        const observation = {
            updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
        };
        if (Number.isFinite(entry.maxPromptTokens) && entry.maxPromptTokens > 0) {
            observation.maxPromptTokens = Math.floor(entry.maxPromptTokens);
        }
        if (typeof entry.reasoning === "boolean") {
            observation.reasoning = entry.reasoning;
        }
        models[id] = observation;
    }
    const window = limits.window;
    return {
        version: 1,
        models,
        ...(window &&
            Number.isFinite(window.tokens) &&
            window.tokens > 0 &&
            Number.isFinite(window.verifiedAt)
            ? {
                window: {
                    tokens: Math.floor(window.tokens),
                    verifiedAt: window.verifiedAt,
                    ...(typeof window.model === "string" ? { model: window.model } : {}),
                },
            }
            : {}),
    };
}
/** Reads the persisted measurements once per process. Never throws. */
export async function loadLiveLimits() {
    if (loaded && cached)
        return cached;
    try {
        cached = sanitize(JSON.parse(await readFile(dataPath(FILE), "utf8")));
    }
    catch {
        cached = emptyLimits();
    }
    loaded = true;
    return cached;
}
/** The measurements loaded for this process. */
export function currentLiveLimits() {
    return cached;
}
async function persist() {
    if (!cached)
        return;
    try {
        const file = dataPath(FILE);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(cached), "utf8");
    }
    catch {
        // Measurements are an optimization; failing to persist changes nothing.
    }
}
function scheduleWrite() {
    if (writeTimer)
        return;
    writeTimer = setTimeout(() => {
        writeTimer = undefined;
        void persist();
    }, WRITE_DEBOUNCE_MS);
    writeTimer.unref?.();
}
function observation(modelID) {
    const limits = (cached ??= emptyLimits());
    limits.models[modelID] ??= { updatedAt: Date.now() };
    return limits.models[modelID];
}
/**
 * Folds a real step's usage into the model's record: the prompt size proves the
 * gateway accepted at least that much context, and reasoning tokens prove the
 * model really reasoned for this account.
 */
export function noteStepTokens(_deps, modelID, tokens) {
    if (!modelID || !tokens)
        return;
    const prompt = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
    const entry = observation(modelID);
    let changed = false;
    if (prompt > 0 && prompt >= (entry.maxPromptTokens ?? 0)) {
        entry.maxPromptTokens = Math.floor(prompt);
        changed = true;
    }
    if ((tokens.reasoning ?? 0) > 0 && entry.reasoning !== true) {
        entry.reasoning = true;
        changed = true;
    }
    if (!changed)
        return;
    entry.updatedAt = Date.now();
    scheduleWrite();
}
/** Whether the persisted window is old enough to verify again. */
export function shouldVerifyWindow(limits) {
    const verifiedAt = limits?.window?.verifiedAt;
    if (!verifiedAt)
        return true;
    return Date.now() - verifiedAt > VERIFY_LIMITS_TTL_MS;
}
function filler(chars) {
    const unit = "the quick brown fox jumps over the lazy dog while maintainers review the patch and debate naming ";
    return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}
async function sendProbe(deps, modelID, chars) {
    const token = await resolveToken(deps).catch(() => undefined);
    if (!token)
        return { status: "failed" };
    const content = `${filler(chars)}\n\nIgnore the filler and reply with OK.`;
    let response;
    try {
        response = await fetch(`${completionsBaseUrl()}/chat/completions`, {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                authorization: `Bearer ${token}`,
                "x-client-version": deps.state.latestClientVersion,
                "x-session-id": `free-pi-window-${Date.now().toString(36)}`,
                "x-ad-context": "none",
            },
            body: JSON.stringify({
                model: modelID,
                messages: [{ role: "user", content }],
                stream: false,
                max_tokens: 256,
            }),
            signal: AbortSignal.timeout(180_000),
        });
    }
    catch {
        return { status: "failed" };
    }
    if (response.status === 413 || response.status === 400) {
        const body = await response.text().catch(() => "");
        if (/context_too_long|too long|context_ceiling/i.test(body)) {
            return { status: "too_long" };
        }
        return { status: "failed" };
    }
    if (!response.ok)
        return { status: "failed" };
    const payload = (await response.json().catch(() => undefined));
    const promptTokens = payload?.usage?.prompt_tokens;
    return {
        status: "ok",
        ...(typeof promptTokens === "number" ? { promptTokens } : {}),
    };
}
/**
 * Checks the compiled window against the gateway by sending the largest prompt
 * that window allows. On rejection it steps down until the gateway accepts, so
 * the next catalog build advertises what the server really takes. Returns the
 * verified window, or `undefined` when nothing could be learned.
 */
export async function verifyGatewayWindow(deps, options = {}) {
    const modelID = options.model;
    if (!modelID)
        return undefined;
    const window = options.window ?? CONTEXT_WINDOW;
    // OpenCode budgets a token as ~4 characters. The gateway rejects by its own
    // prompt size, so aim just under what the window allows in characters; the
    // reported prompt_tokens are logged for comparison but do not decide the
    // result.
    const targetChars = Math.max(MIN_WINDOW * 4, Math.floor(window * 4 * 0.99));
    for (const factor of [1, 0.85, 0.7, 0.55]) {
        const chars = Math.floor(targetChars * factor);
        if (chars < MIN_WINDOW)
            break;
        const result = await sendProbe(deps, modelID, chars);
        if (result.status === "failed")
            return undefined;
        if (result.status === "too_long")
            continue;
        // Passing the full target confirms the compiled window. After a rejection,
        // only the reduced target is proven, so advertise that instead.
        const verified = factor === 1 ? window : Math.max(MIN_WINDOW, Math.floor(window * factor));
        const limits = (cached ??= emptyLimits());
        limits.window = { tokens: verified, verifiedAt: Date.now(), model: modelID };
        loaded = true;
        await persist();
        deps.log.info("free-pi verified the gateway context window", {
            model: modelID,
            window: verified,
            compiled: window,
            probedChars: chars,
            probedTokens: result.promptTokens,
        });
        return verified;
    }
    return undefined;
}
