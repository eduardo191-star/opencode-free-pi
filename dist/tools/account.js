/**
 * Account helpers that mirror the provider CLI: `free_pi_buy_credits` and the
 * built-in `free_pi_docs` guide.
 */
import { browserAvailable, openBrowser } from "../utils/browser.js";
import { safeUrl } from "../utils/urls.js";
import { done, fail, freePiRequest, GATED_TEXT, isGatedSession, } from "./api.js";
const NO_INPUT = {
    type: "object",
    additionalProperties: false,
    properties: {},
};
const BUY_NOT_AVAILABLE = "Buying credits is not available on this server yet.";
function buyPageText(url) {
    return `Opening the buy page in your browser. If it did not open (for example over SSH), visit:
${url}

Packs: $5 = 50,000 credits, $10 = 100,000 credits. Card or USDC.`;
}
async function executeBuy(deps, context) {
    if (!isGatedSession(deps, context.sessionID))
        return fail(GATED_TEXT);
    const result = await freePiRequest(deps, {
        path: "/me",
        timeoutMs: 5_000,
        signal: context.signal,
        audience: "model",
    });
    if (!result.ok)
        return fail(result.text);
    const url = safeUrl(result.data?.buy_url);
    if (!url) {
        return done(BUY_NOT_AVAILABLE, { available: false });
    }
    const opened = browserAvailable() ? await openBrowser(url) : false;
    deps.log.info("free_pi_buy_credits opened the buy page", {
        opened,
        url,
    });
    return done(buyPageText(url), { buy_url: url, opened });
}
export const FREE_PI_DOCS = `# free-pi in OpenCode

free-pi is a free, ad-supported way to run coding models. You sign in with
GitHub, and ads shown in the session pay for the inference. You never handle a
model API key. The free daily allowance can change with supply and demand.

## Checking usage and credits
- \`free_pi_usage\` shows today's remaining allowance, purchased credits, token
  counts and your account tier.
- \`free_pi_buy_credits\` opens the buy page. Purchased credits cover use beyond
  the free allowance.
- The dashboard at https://freepi.ai/dashboard shows usage, credits and privacy.

## Tools that spend the daily allowance
- \`look_at_image\` asks a vision model about a PNG, JPEG or WebP inside the
  project. free-pi models are text-only, so they cannot see images otherwise.
- \`generate_image\` draws one image from a prompt and saves it under \`images/\`.
- \`web_search\` searches the web for current information.
- \`docs_lookup\` looks up current library and framework documentation.
- \`free_pi_usage\`, \`free_pi_buy_credits\` and \`free_pi_docs\` are read-only.

## Agents and sessions
- The Fusion agent gathers context, asks a planning model for a step-by-step
  plan, and then implements it. Fusion needs the planner model in the catalog;
  otherwise it falls back to the default free-pi model.
- Subagents inherit the parent's free-pi allowance and count against the same
  daily budget.
- A session's server slot is closed shortly after its last step. If another
  terminal is stuck, close that session before starting a new one.

## Limits
- One image question can run at a time; \`look_at_image\` queues and waits.
- Usage limits (\`daily_cap\`, \`rolling_cap\`, concurrency) are terminal: the
  agent is told to stop and continue without the tool rather than retrying.
`;
async function executeDocs(deps, context, raw) {
    if (raw && typeof raw === "object" && Object.keys(raw).length > 0) {
        return fail("free_pi_docs takes no arguments.");
    }
    if (!isGatedSession(deps, context.sessionID)) {
        return fail(GATED_TEXT);
    }
    return done(FREE_PI_DOCS, { ok: true });
}
export async function registerAccountTools(ctx, deps) {
    return ctx.tool.transform((editor) => {
        editor.add({
            name: "free_pi_buy_credits",
            description: "Open the free-pi buy-credits page in the browser (and print the URL, for SSH sessions with no browser). Read-only against the server, takes no arguments.",
            input: NO_INPUT,
            options: { codemode: false },
            execute: (_input, context) => executeBuy(deps, context),
        });
        editor.add({
            name: "free_pi_docs",
            description: "Return the built-in free-pi guide: what it is, how the free allowance, credits, ads and tools work. Read-only, takes no arguments, makes no network calls.",
            input: NO_INPUT,
            options: { codemode: false },
            execute: (input, context) => executeDocs(deps, context, input),
        });
    });
}
