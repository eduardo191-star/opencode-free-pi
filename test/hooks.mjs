import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "freepi-hooks-"));
process.env.FREE_PI_DATA_DIR = dir;
process.env.FREEPI_CREDENTIALS_PATH = join(dir, "missing-credentials.json");
process.env.FREEPI_BASE_URL = "https://api.test";
delete process.env.FREEPI_JWT;

const { registerSessionHooks } = await import("../dist/session/hooks.js");
const { createRuntimeState } = await import("../dist/state.js");
const { recordUsage } = await import("../dist/session/usage.js");
const {
  MAX_OUTPUT_TOKENS,
  FREE_PI_GUIDANCE_MARKER,
  FREE_PI_COMPACTION_MARKER,
} = await import("../dist/constants.js");

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
const toolHooks = new Map();
const ctx = {
  session: {
    hook: async (name, callback, options) => {
      const list = hooks.get(name) ?? [];
      list.push({ callback, providerID: options?.providerID });
      hooks.set(name, list);
      return { dispose: async () => {} };
    },
  },
  tool: {
    hook: async (name, callback) => {
      const list = toolHooks.get(name) ?? [];
      list.push({ callback });
      toolHooks.set(name, list);
      return { dispose: async () => {} };
    },
  },
};

const warnings = [];
const infos = [];
const deps = {
  state: createRuntimeState(),
  log: {
    log() {},
    info(message, extra) {
      infos.push({ message, extra });
    },
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
  // 8 session hooks for each provider, plus the two global tool hooks.
  assert.equal(registrations.length, 18);
  for (const name of [
    "context",
    "compaction",
    "generate",
    "title",
    "model.request",
    "http.request",
    "http.response",
    "retry",
  ]) {
    const list = hooks.get(name) ?? [];
    assert.deepEqual(
      list.map((item) => item.providerID).sort(),
      ["free-pi", "free-pi-defense"],
      `${name} is registered for both providers`,
    );
  }

  deps.state.outputLimits.set("free-pi/hy4-flash", 65536);
  deps.state.latestClientVersion = "9.9.9";

  const userMessage = {
    id: "msg_1",
    role: "user",
    content: [{ type: "text", text: "hello from the user" }],
  };

  // Primary generation: caps output tokens, resolves a turn and adds the
  // free-pi working rules.
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
    contextEvent.system.some(
      (part) =>
        typeof part.text === "string" &&
        part.text.startsWith(FREE_PI_GUIDANCE_MARKER),
    ),
    "free-pi working rules are appended",
  );
  // Reusing the same request must not stack duplicate guidance blocks.
  const reusedSystem = [...contextEvent.system];
  await invoke("context", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    system: reusedSystem,
    messages: [userMessage],
    options: {},
  });
  assert.equal(
    reusedSystem.filter(
      (part) =>
        typeof part.text === "string" &&
        part.text.startsWith(FREE_PI_GUIDANCE_MARKER),
    ).length,
    1,
    "guidance is not duplicated",
  );

  // Outgoing model request: auth, session, client version and turn headers.
  const primary = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.equal(primary.headers.authorization, "Bearer test-token");
  assert.match(primary.headers["x-session-id"], /^ses_parent-r/);
  assert.equal(primary.headers["x-client-version"], "9.9.9");
  assert.equal(primary.headers["x-freepi-cost-exp"], undefined);
  assert.match(primary.headers["x-turn-id"], /^[0-9a-f-]{36}$/);
  const primaryAdContext = JSON.parse(
    Buffer.from(primary.headers["x-ad-context"], "base64url").toString("utf8"),
  );
  assert.equal(primaryAdContext.user, "hello from the user");

  // A new user message rotates the ad turn (new x-turn-id) while keeping the
  // same provider session. This is what keeps free-pi from reusing a stale ad.
  await invoke("context", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    system: [],
    messages: [
      {
        id: "msg_parent_2",
        role: "user",
        content: [{ type: "text", text: "second turn" }],
      },
    ],
    options: {},
  });
  const secondTurn = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.notEqual(secondTurn.headers["x-turn-id"], primary.headers["x-turn-id"]);

  // Provider messages without ids must still rotate: the fingerprint changes
  // when the user message count does, so no ad is reused across turns.
  const noIdTurn = async (texts) => {
    await invoke("context", "free-pi", {
      sessionID: "ses_noid",
      agent: "build",
      kind: "primary",
      model: { providerID: "free-pi", id: "hy4-flash" },
      system: [],
      messages: texts.map((text) => ({
        role: "user",
        content: [{ type: "text", text }],
      })),
      options: {},
    });
    return invoke("model.request", "free-pi", {
      sessionID: "ses_noid",
      agent: "build",
      kind: "primary",
      model: { providerID: "free-pi", id: "hy4-flash" },
      headers: {},
    });
  };
  const noIdFirst = await noIdTurn(["first prompt"]);
  const noIdSecond = await noIdTurn(["first prompt", "second prompt"]);
  assert.notEqual(noIdFirst.headers["x-turn-id"], noIdSecond.headers["x-turn-id"]);

  // A turn that ended mid-stream marks its wire id dirty; the next request
  // rotates to a fresh id before going out, so the turn continues without
  // hitting the stale per-session lock (and therefore without a retry).
  deps.state.dirtySessions.add("ses_dirty");
  const afterDirty = await invoke("model.request", "free-pi", {
    sessionID: "ses_dirty",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.match(afterDirty.headers["x-session-id"], /^ses_dirty-r/);
  assert.equal(deps.state.dirtySessions.has("ses_dirty"), false);

  // Ad request headers carry the same turn plus the redacted context payload.
  const adCall = calls.find((call) => call.url.includes("/ads/next"));
  assert.ok(adCall, "an ad is requested for the turn");
  const adHeaders = adCall.headers;
  assert.equal(adHeaders["x-turn-id"], primary.headers["x-turn-id"]);
  assert.equal(adHeaders["x-session-id"], primary.headers["x-session-id"]);
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
  assert.equal(
    childAds.at(-1).headers["x-session-id"],
    child.headers["x-session-id"],
  );
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

  // Title requests are answered locally so they cost no credits and no ad.
  const title = await invoke("title", "free-pi", {
    sessionID: "ses_parent",
    kind: "title",
    model: { providerID: "free-pi", id: "hy4-flash" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Here is the first message of the conversation:\n\n<message>\nFix the login redirect bug\n</message>\n\nReply with only the title.",
          },
        ],
      },
    ],
    options: {},
    system: [],
  });
  assert.equal(title.result, "Fix the login redirect bug");

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

  // Child sessions carry the same marker as the CLI's subagent providers.
  deps.state.subagentSessions.add("ses_child");
  const childRequest = await invoke("model.request", "free-pi", {
    sessionID: "ses_child",
    agent: "explore",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.equal(childRequest.headers["x-freepi-subagent"], "1");

  // Tool outcomes reach the next model request as free-pi's three headers.
  const toolBefore = toolHooks.get("execute.before")[0];
  const toolAfter = toolHooks.get("execute.after")[0];
  assert.ok(toolBefore && toolAfter, "tool hooks are registered");
  toolBefore.callback({
    sessionID: "ses_parent",
    agent: "build",
    messageID: "msg_tool",
    id: "call_1",
    tool: "shell",
    input: {},
  });
  toolAfter.callback({
    sessionID: "ses_parent",
    agent: "build",
    messageID: "msg_tool",
    id: "call_1",
    tool: "shell",
    input: {},
    status: "completed",
    result: { metadata: { exit: 0, truncated: false } },
  });
  toolAfter.callback({
    sessionID: "ses_parent",
    agent: "build",
    messageID: "msg_tool",
    id: "call_2",
    tool: "read",
    input: {},
    status: "error",
    error: new Error("missing file"),
  });
  const withTools = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.match(
    withTools.headers["x-freepi-tool-meta"],
    /^v1:call_1~\d+~0~0,call_2~\d+~-~0$/,
  );
  assert.equal(withTools.headers["x-freepi-tool-errors"], "v1:call_2");

  // free-pi is text-only, so a read image is replaced when the tool settles:
  // the base64 payload never enters the session or a later compaction.
  const imageEvent = {
    sessionID: "ses_parent",
    agent: "build",
    messageID: "msg_tool",
    id: "call_3",
    tool: "read",
    input: { path: "captures/photo.jpg" },
    status: "completed",
    result: {
      content: [
        { type: "text", text: "Image read successfully" },
        {
          type: "file",
          uri: "data:image/jpeg;base64,AAAA",
          mime: "image/jpeg",
          name: "photo.jpg",
        },
      ],
    },
  };
  await toolAfter.callback(imageEvent);
  assert.deepEqual(imageEvent.result.content, [
    { type: "text", text: "Image read successfully" },
    {
      type: "text",
      text: 'ERROR: Cannot read "photo.jpg" (free-pi models take text only). If you need its content, call look_at_image with path "captures/photo.jpg" and a specific question.',
    },
  ]);

  // Sessions served by any other provider keep their media untouched.
  const otherProviderEvent = {
    sessionID: "ses_other",
    agent: "build",
    messageID: "msg_tool",
    id: "call_4",
    tool: "read",
    input: {},
    status: "completed",
    result: {
      content: [
        {
          type: "file",
          uri: "data:image/jpeg;base64,AAAA",
          mime: "image/jpeg",
          name: "photo.jpg",
        },
      ],
    },
  };
  await toolAfter.callback(otherProviderEvent);
  assert.equal(otherProviderEvent.result.content[0].type, "file");

  // A compaction marks the next request with the number of folded messages and
  // asks the summarizer to keep the facts a later turn needs.
  const compactEvent = await invoke("compaction", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "compaction",
    model: { providerID: "free-pi", id: "hy4-flash" },
    system: [],
    messages: [userMessage, userMessage, userMessage],
    options: {},
  });
  assert.ok(
    compactEvent.system.some(
      (part) =>
        typeof part.text === "string" &&
        part.text.startsWith(FREE_PI_COMPACTION_MARKER),
    ),
    "compaction guidance is appended",
  );
  const afterCompaction = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.equal(afterCompaction.headers["x-freepi-compacted"], "v1:3");

  // Compaction reuses the current turn but opts out of ad context.
  const compactionRequest = await invoke("model.request", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "compaction",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.equal(compactionRequest.headers["x-ad-context"], "none");

  // Retry follows pi's 3 attempts, 2s base and 60s cap.
  const retry = await invoke("retry", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { type: "unknown" },
    attempt: 2,
    decision: { retry: true, delay: 999_999 },
  });
  assert.deepEqual(retry.decision, { retry: true, delay: 2_000 });
  const secondRetry = await invoke("retry", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { type: "unknown" },
    attempt: 4,
    decision: { retry: true, delay: 1 },
  });
  assert.deepEqual(secondRetry.decision, { retry: true, delay: 8_000 });
  const exhausted = await invoke("retry", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { type: "unknown" },
    attempt: 5,
    decision: { retry: true, delay: 1 },
  });
  assert.deepEqual(exhausted.decision, { retry: false });
  const notRetryable = await invoke("retry", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { type: "unknown" },
    attempt: 2,
    decision: { retry: false },
  });
  assert.deepEqual(notRetryable.decision, { retry: false });

  // `concurrent` (429, one request at a time) is retried: the plugin rotates
  // the wire session id and releases the old one so a leaked per-session lock
  // in the server cannot fail the turn forever.
  const concurrent = await invoke("retry", "free-pi", {
    sessionID: "ses_busy",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: {
      type: "rate_limit",
      status: 429,
      message: "one request at a time, 5,351 credits left today",
    },
    attempt: 1,
    decision: { retry: false },
  });
  assert.deepEqual(concurrent.decision, { retry: true, delay: 1_000 });
  const rotated = deps.state.wireSessions.get("ses_busy");
  assert.match(rotated, /^ses_busy-r/);
  await Promise.all([...deps.state.sessionClosePromises.values()]);
  assert.ok(
    calls.some(
      (call) =>
        call.url.endsWith("/session/reset") &&
        call.headers["x-session-id"] === "ses_busy",
    ),
    "the old wire session id is released",
  );

  // Later requests on the OpenCode session use the rotated id.
  const afterRotate = await invoke("model.request", "free-pi", {
    sessionID: "ses_busy",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    headers: {},
  });
  assert.equal(afterRotate.headers["x-session-id"], rotated);

  const concurrentAgain = await invoke("retry", "free-pi", {
    sessionID: "ses_busy",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { status: 429, message: "one request at a time" },
    attempt: 3,
    decision: { retry: false },
  });
  assert.deepEqual(concurrentAgain.decision, { retry: true, delay: 4_000 });

  const concurrentExhausted = await invoke("retry", "free-pi", {
    sessionID: "ses_busy",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { status: 429, message: "one request at a time" },
    attempt: 7,
    decision: { retry: true, delay: 1 },
  });
  assert.deepEqual(concurrentExhausted.decision, { retry: false });

  // A terminal 429 (free usage limit) fails immediately instead of showing the
  // endless "Retrying…" that OpenCode applies to every rate limit.
  const terminal = await invoke("retry", "free-pi", {
    sessionID: "ses_quota",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: {
      type: "rate_limit",
      status: 429,
      message:
        "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go",
    },
    attempt: 1,
    decision: { retry: true, delay: 1_000 },
  });
  assert.deepEqual(terminal.decision, { retry: false });

  // An aborted turn is never retried: the user stopped it on purpose.
  const aborted = await invoke("retry", "free-pi", {
    sessionID: "ses_abort",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { type: "aborted", message: "Aborted" },
    attempt: 1,
    decision: { retry: true, delay: 1_000 },
  });
  assert.deepEqual(aborted.decision, { retry: false });
  // The next turn must not reuse the possibly locked id.
  assert.equal(deps.state.dirtySessions.has("ses_abort"), true);

  // A transient capacity 429 still uses pi's retry policy.
  const capacity = await invoke("retry", "free-pi", {
    sessionID: "ses_capacity",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: {
      type: "rate_limit",
      status: 429,
      message: "model is at capacity",
    },
    attempt: 2,
    decision: { retry: true },
  });
  assert.deepEqual(capacity.decision, { retry: true, delay: 2_000 });

  // OpenCode reuses the prepared request on retry, so a `concurrent` 429 is
  // replayed here with a fresh wire session id and OpenCode only sees the 200.
  const replayCalls = [];
  const replayMock = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof URL ? input.href : input);
    const headers = new Headers(init.headers ?? {});
    const sid = headers.get("x-session-id");
    replayCalls.push({ url, sid });
    if (sid && sid.includes("-r")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        code: "concurrent",
        message: "one request at a time, 5,351 credits left today",
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
  };
  const replayRequest = new Request(
    "https://api.test/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-id": "ses_replay",
        "x-turn-id": "turn-replay",
      },
      body: JSON.stringify({ model: "hy4-flash", messages: [] }),
    },
  );
  const replayModel = { providerID: "free-pi", id: "hy4-flash" };
  await invoke("http.request", "free-pi", {
    sessionID: "ses_replay",
    agent: "build",
    kind: "primary",
    model: replayModel,
    request: replayRequest,
  });
  const replayed = await invoke("http.response", "free-pi", {
    sessionID: "ses_replay",
    agent: "build",
    kind: "primary",
    model: replayModel,
    request: replayRequest,
    response: new Response(
      JSON.stringify({
        code: "concurrent",
        message: "one request at a time, 5,351 credits left today",
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    ),
  });
  assert.equal(replayed.response.status, 200);
  assert.deepEqual(await replayed.response.json(), { ok: true });
  assert.match(deps.state.wireSessions.get("ses_replay"), /^ses_replay-r/);
  assert.ok(
    replayCalls.some((call) => call.sid?.startsWith("ses_replay-r")),
    JSON.stringify(replayCalls),
  );
  globalThis.fetch = replayMock;
  await Promise.all([...deps.state.sessionClosePromises.values()]);

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

  // A gateway that reports an overflow for a small request is failing, not
  // overflowing: the request is replayed on a fresh wire session instead of
  // asking OpenCode to compact a conversation that already fits.
  {
    const originalFetch = globalThis.fetch;
    const attempts = [];
    globalThis.fetch = async (input, init = {}) => {
      const headers = new Headers(init.headers ?? {});
      const sid = headers.get("x-session-id");
      attempts.push(sid);
      if (sid && sid.includes("-r")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ code: "context_ceiling" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    };
    const smallBody = JSON.stringify({
      model: "hy4-flash",
      messages: [{ role: "user", content: "x".repeat(4_000) }],
    });
    const smallRequest = new Request("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-id": "ses_spurious",
        "x-turn-id": "turn-spurious",
      },
      body: smallBody,
    });
    const spuriousModel = { providerID: "free-pi", id: "hy4-flash" };
    await invoke("http.request", "free-pi", {
      sessionID: "ses_spurious",
      agent: "build",
      kind: "primary",
      model: spuriousModel,
      request: smallRequest,
    });
    const recoveredEvent = await invoke("http.response", "free-pi", {
      sessionID: "ses_spurious",
      agent: "build",
      kind: "primary",
      model: spuriousModel,
      request: smallRequest,
      response: new Response(JSON.stringify({ code: "context_ceiling" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    });
    assert.equal(recoveredEvent.response.status, 200);
    assert.deepEqual(await recoveredEvent.response.json(), { ok: true });
    assert.ok(
      attempts.some((sid) => sid?.startsWith("ses_spurious-r")),
      JSON.stringify(attempts),
    );

    // The same rejection for a conversation that really is huge stays an
    // overflow, so the runner compacts and retries as usual.
    const hugeBody = JSON.stringify({
      model: "hy4-flash",
      messages: [{ role: "user", content: "x".repeat(400_000) }],
    });
    const hugeRequest = new Request("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-id": "ses_huge",
        "x-turn-id": "turn-huge",
      },
      body: hugeBody,
    });
    attempts.length = 0;
    await invoke("http.request", "free-pi", {
      sessionID: "ses_huge",
      agent: "build",
      kind: "primary",
      model: spuriousModel,
      request: hugeRequest,
    });
    const hugeEvent = await invoke("http.response", "free-pi", {
      sessionID: "ses_huge",
      agent: "build",
      kind: "primary",
      model: spuriousModel,
      request: hugeRequest,
      response: new Response(JSON.stringify({ code: "context_too_long" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      }),
    });
    assert.equal(hugeEvent.response.status, 400);
    assert.equal(attempts.length, 0);
    assert.match(await hugeEvent.response.text(), /prompt is too long/i);
    globalThis.fetch = originalFetch;
  }

  // After a few rejections of requests that fit, another compaction would only
  // spend credits: the error stops looking like an overflow and the next turn
  // rotates the wire session.
  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: "context_ceiling" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    const stormModel = { providerID: "free-pi", id: "hy4-flash" };
    let stormEvent;
    for (let index = 0; index < 4; index++) {
      const request = new Request("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-id": "ses_storm",
          "x-turn-id": `turn-storm-${index}`,
        },
        body: JSON.stringify({
          model: "hy4-flash",
          messages: [{ role: "user", content: "x".repeat(4_000) }],
        }),
      });
      await invoke("http.request", "free-pi", {
        sessionID: "ses_storm",
        agent: "build",
        kind: "primary",
        model: stormModel,
        request,
      });
      stormEvent = await invoke("http.response", "free-pi", {
        sessionID: "ses_storm",
        agent: "build",
        kind: "primary",
        model: stormModel,
        request,
        response: new Response(JSON.stringify({ code: "context_ceiling" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      });
    }
    const stormBody = await stormEvent.response.text();
    assert.match(stormBody, /provider failure, not a context overflow/i);
    assert.doesNotMatch(stormBody, /prompt is too long/i);
    assert.equal(stormEvent.response.status, 400);
    assert.equal(deps.state.dirtySessions.has("ses_storm"), true);
    globalThis.fetch = originalFetch;
  }

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

  const unexpected = warnings.filter(
    (entry) => !/compact loop stopped/i.test(entry.message),
  );
  assert.equal(unexpected.length, 0, JSON.stringify(warnings));
  console.log("ok");
} finally {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
}
