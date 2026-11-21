import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "freepi-hooks-"));
process.env.FREE_PI_CACHE_DIR = dir;
process.env.FREEPI_CREDENTIALS_PATH = join(dir, "missing-credentials.json");
process.env.FREEPI_BASE_URL = "https://api.test";
delete process.env.FREEPI_JWT;

const { registerSessionHooks } = await import("../dist/session/hooks.js");
const { createRuntimeState } = await import("../dist/state.js");
const { recordUsage } = await import("../dist/session/usage.js");
const { MAX_OUTPUT_TOKENS, EFFICIENCY_RULE } = await import("../dist/constants.js");

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input.href : input);
  calls.push({ url, headers: init.headers ?? {} });
  if (url.includes("/ads/next")) return new Response(null, { status: 204 });
  if (url.endsWith("/me")) {
    return new Response(JSON.stringify({ credits: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("{}", { status: 200 });
};

const hooks = new Map();
const ctx = {
  session: {
    hook: async (name, callback, options) => {
      const list = hooks.get(name) ?? [];
      list.push({ callback, providerID: options?.providerID });
      hooks.set(name, list);
      return { dispose: async () => {} };
    },
  },
};

const warnings = [];
const deps = {
  state: createRuntimeState(),
  log: {
    log() {},
    info() {},
    error() {},
    warn(message, extra) {
      warnings.push({ message, extra });
    },
  },
  activeCredential: async () => ({
    type: "key",
    key: "test-token",
    metadata: { expires: String(Date.now() + 3_600_000) },
  }),
  readContext: async () => [],
};

const invoke = async (name, providerID, event) => {
  const entry = (hooks.get(name) ?? []).find(
    (item) => item.providerID === providerID,
  );
  assert.ok(entry, `hook ${name} registered for ${providerID}`);
  await entry.callback(event);
  return event;
};

try {
  const registrations = await registerSessionHooks(ctx, deps);
  assert.equal(registrations.length, 12);
  for (const name of [
    "context",
    "compaction",
    "generate",
    "title",
    "model.request",
    "http.response",
  ]) {
    const list = hooks.get(name) ?? [];
    assert.deepEqual(
      list.map((item) => item.providerID).sort(),
      ["free-pi", "free-pi-defense"],
      `${name} is registered for both providers`,
    );
  }

  deps.state.costExperimentArm = "efficiency";
  deps.state.outputLimits.set("free-pi/hy4-flash", 65536);
  deps.state.latestClientVersion = "9.9.9";

  const userMessage = {
    id: "msg_1",
    role: "user",
    content: [{ type: "text", text: "hello from the user" }],
  };

  // Primary generation: caps output tokens, adds the efficiency rule, resolves a turn.
  const contextEvent = await invoke("context", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    system: [{ type: "text", text: "base instructions" }],
    messages: [userMessage],
    options: { maxTokens: 1_000_000 },
  });
  assert.equal(contextEvent.options.maxTokens, MAX_OUTPUT_TOKENS);
  assert.ok(
    contextEvent.system.some((part) => part.text === EFFICIENCY_RULE),
    "efficiency rule is appended",
  );

  // Outgoing model request: auth, session, client version, experiment and turn headers.
  const primary = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.equal(primary.headers.authorization, "Bearer test-token");
  assert.equal(primary.headers["x-session-id"], "ses_parent");
  assert.equal(primary.headers["x-client-version"], "9.9.9");
  assert.equal(primary.headers["x-freepi-cost-exp"], "efficiency");
  assert.match(primary.headers["x-turn-id"], /^[0-9a-f-]{36}$/);

  // Ad request headers carry the same turn plus the redacted context payload.
  const adCall = calls.find((call) => call.url.includes("/ads/next"));
  assert.ok(adCall, "an ad is requested for the turn");
  const adHeaders = adCall.headers;
  assert.equal(adHeaders["x-turn-id"], primary.headers["x-turn-id"]);
  assert.equal(adHeaders["x-session-id"], "ses_parent");
  assert.equal(adHeaders["x-ad-trigger"], "user_message");
  assert.equal(adHeaders.authorization, "Bearer test-token");
  const adContext = JSON.parse(
    Buffer.from(adHeaders["x-ad-context"], "base64url").toString("utf8"),
  );
  assert.equal(adContext.user, "hello from the user");

  // A subagent gets its own ad turn, its own ad request and its own context.
  const adCountBeforeChild = calls.filter((call) =>
    call.url.includes("/ads/next"),
  ).length;
  const taskMessage = {
    id: "msg_2",
    role: "user",
    content: [{ type: "text", text: "subagent task prompt" }],
  };
  await invoke("context", "free-pi", {
    sessionID: "ses_parent",
    agent: "general",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    system: [],
    messages: [taskMessage],
    options: {},
  });
  const child = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "general",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.notEqual(child.headers["x-turn-id"], primary.headers["x-turn-id"]);
  const childAds = calls.filter((call) => call.url.includes("/ads/next"));
  assert.equal(
    childAds.length,
    adCountBeforeChild + 1,
    "the subagent requests its own ad",
  );
  assert.equal(childAds.at(-1).headers["x-turn-id"], child.headers["x-turn-id"]);
  assert.equal(childAds.at(-1).headers["x-session-id"], "ses_parent");
  const childContext = JSON.parse(
    Buffer.from(childAds.at(-1).headers["x-ad-context"], "base64url").toString(
      "utf8",
    ),
  );
  assert.equal(childContext.user, "subagent task prompt");

  // A later step of the same agent reuses the turn and its impression.
  const repeat = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "general",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.equal(repeat.headers["x-turn-id"], child.headers["x-turn-id"]);
  assert.equal(
    calls.filter((call) => call.url.includes("/ads/next")).length,
    childAds.length,
    "a settled turn does not fetch another ad",
  );

  // Defense provider is handled by the same logic.
  const defense = await invoke("model.request", "free-pi-defense", {
    sessionID: "ses_defense",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi-defense", id: "gemma-4-uncensored" },
    headers: {},
  });
  assert.equal(defense.headers.authorization, "Bearer test-token");

  // Other providers are ignored entirely.
  const other = await invoke("model.request", "free-pi", {
    sessionID: "ses_other",
    agent: "build",
    kind: "primary",
    model: { providerID: "opencode", id: "gpt" },
    headers: {},
  });
  assert.deepEqual(other.headers, {});

  // Title requests are suppressed so they do not spend a session slot.
  const title = await invoke("title", "free-pi", {
    sessionID: "ses_parent",
    kind: "title",
    model: { providerID: "free-pi", id: "hy4-flash" },
    messages: [],
    options: {},
    system: [],
  });
  assert.equal(title.result, "");

  // The suppressed title request must not spend an ad impression either.
  const adCountBeforeTitle = calls.filter((call) =>
    call.url.includes("/ads/next"),
  ).length;
  const titleRequest = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "title",
    kind: "title",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.equal(titleRequest.headers["x-turn-id"], undefined);
  assert.equal(
    calls.filter((call) => call.url.includes("/ads/next")).length,
    adCountBeforeTitle,
    "title requests do not fetch an ad",
  );

  // Long-lived limits are rewritten to a friendly 400.
  const limited = new Response(
    JSON.stringify({
      code: "hourly_ceiling",
      message: "slow down",
      retry_after_seconds: 3600,
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
  const responseEvent = await invoke("http.response", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    request: new Request("https://api.test/v1/chat/completions"),
    response: limited,
  });
  assert.equal(responseEvent.response.status, 400);
  assert.equal(
    responseEvent.response.headers.get("x-free-pi-original-status"),
    "429",
  );

  // A context overflow is rewritten to the message OpenCode classifies as
  // context-overflow, so the runner compacts and retries the turn.
  const overflow = new Response(
    JSON.stringify({
      code: "context_too_long",
      message: "this conversation is too long",
      limit: "context_too_long",
    }),
    { status: 413, headers: { "content-type": "application/json" } },
  );
  const overflowEvent = await invoke("http.response", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    request: new Request("https://api.test/v1/chat/completions"),
    response: overflow,
  });
  assert.equal(overflowEvent.response.status, 400);
  assert.equal(
    overflowEvent.response.headers.get("x-free-pi-original-status"),
    "413",
  );
  assert.equal(
    overflowEvent.response.headers.get("x-free-pi-original-code"),
    "context_too_long",
  );
  const overflowBody = await overflowEvent.response.text();
  assert.match(overflowBody, /prompt is too long/i);
  assert.doesNotMatch(overflowBody, /conversation is too long/i);

  // A 429 context ceiling is an overflow, not a long-lived rate limit, so it
  // must be rewritten before the friendly 429 handler sees it.
  const ceiling = new Response(
    JSON.stringify({
      code: "context_ceiling",
      message: "this conversation is too large",
      retry_after_seconds: 3600,
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
  const ceilingEvent = await invoke("http.response", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    request: new Request("https://api.test/v1/chat/completions"),
    response: ceiling,
  });
  assert.equal(ceilingEvent.response.status, 400);
  assert.equal(
    ceilingEvent.response.headers.get("x-free-pi-original-status"),
    "429",
  );
  assert.match(await ceilingEvent.response.text(), /prompt is too long/i);

  // Usage tracking feeds the quota endpoint.
  deps.state.trackedModels.set("ses_parent", {
    providerID: "free-pi",
    modelID: "hy4-flash",
  });
  recordUsage(deps, "ses_parent", 0.5, {
    input: 120,
    output: 30,
    reasoning: 7,
    cache: { read: 10, write: 2 },
  });
  assert.equal(deps.state.lastUsage.input, 120);
  assert.equal(deps.state.lastUsage.output, 30);
  assert.equal(deps.state.lastUsage.reasoning, 7);
  assert.equal(deps.state.lastUsage.cacheRead, 10);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(
    calls.some(
      (call) =>
        call.url.endsWith("/me") &&
        call.headers.authorization === "Bearer test-token",
    ),
    "usage refreshes the free-pi quota",
  );

  assert.equal(warnings.length, 0, JSON.stringify(warnings));
  console.log("ok");
} finally {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
}
