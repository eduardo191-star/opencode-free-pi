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
const { isFreePiSession } = await import("../dist/session/tools.js");
const { createRuntimeState } = await import("../dist/state.js");
const { recordUsage } = await import("../dist/session/usage.js");
const {
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_CEILING,
  FREE_PI_GUIDANCE_MARKER,
  FREE_PI_COMPACTION_MARKER,
  RECENT_WINDOW_MARKER,
  RECENT_WINDOW_CARRY_MARKER,
  TURN_REMINDER_MARKER,
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
  provider: {
    reload: async () => {
      reloads += 1;
    },
  },
};

const warnings = [];
const infos = [];
let reloads = 0;
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

const invokeGlobal = async (name, event) => {
  const entry = (hooks.get(name) ?? []).find(
    (item) => item.providerID === undefined,
  );
  assert.ok(entry, `hook ${name} registered for every provider`);
  await entry.callback(event);
  return event;
};

try {
  const registrations = await registerSessionHooks(ctx, deps);
  // 8 session hooks for each provider, 3 unscoped context hooks that hide the
  // plugin's tools from other providers, 1 unscoped model tracker, and the two
  // global tool hooks.
  assert.equal(registrations.length, 22);
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
    const providers = list
      .map((item) => item.providerID)
      .filter((value) => value !== undefined)
      .sort();
    assert.deepEqual(
      providers,
      ["free-pi", "free-pi-defense"],
      `${name} is registered for both providers`,
    );
    if (["context", "compaction", "generate"].includes(name)) {
      assert.equal(
        list.filter((item) => item.providerID === undefined).length,
        1,
        `${name} also has an unscoped tool-scoping hook`,
      );
    }
  }

  deps.state.outputLimits.set("free-pi/hy4-flash", 1_000_000);
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
  assert.equal(contextEvent.options.maxTokens, MAX_OUTPUT_TOKENS_CEILING);
  assert.ok(
    contextEvent.system.some(
      (part) =>
        typeof part.text === "string" &&
        part.text.startsWith(FREE_PI_GUIDANCE_MARKER),
    ),
    "free-pi working rules are appended",
  );
  // The turn check rides at the end of the request, where the free models read
  // it, and it is not part of the user's own messages.
  const reminderParts = contextEvent.messages.flatMap((message) =>
    (message.content ?? []).filter(
      (part) =>
        typeof part.text === "string" &&
        part.text.startsWith(TURN_REMINDER_MARKER),
    ),
  );
  assert.equal(reminderParts.length, 1, "one turn reminder is appended");
  assert.equal(
    contextEvent.messages.at(-1)?.role,
    "user",
    "the turn reminder is the last message",
  );
  // Reusing an event that already carries it must not stack another copy.
  await invoke("context", "free-pi", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    system: [],
    messages: contextEvent.messages,
    options: {},
  });
  assert.equal(
    contextEvent.messages.filter((message) =>
      (message.content ?? []).some(
        (part) =>
          typeof part.text === "string" &&
          part.text.startsWith(TURN_REMINDER_MARKER),
      ),
    ).length,
    1,
    "the turn reminder is not duplicated",
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
      text: 'ERROR: Cannot read "photo.jpg" (this free-pi model takes text only). If you need its content, call look_at_image with path "captures/photo.jpg" and a specific question, or switch to a model that accepts image input.',
    },
  ]);

  // A model whose upstream accepts images keeps the read image: the gateway
  // forwards image parts and the model sees the picture natively.
  deps.state.freePiSessions.add("ses_vision");
  deps.state.trackedModels.set("ses_vision", {
    providerID: "free-pi",
    modelID: "vision-model",
  });
  deps.state.imageModels.add("free-pi/vision-model");
  const visionEvent = {
    sessionID: "ses_vision",
    agent: "build",
    messageID: "msg_tool",
    id: "call_3b",
    tool: "read",
    input: { path: "captures/photo.jpg" },
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
  await toolAfter.callback(visionEvent);
  assert.equal(visionEvent.result.content[0].type, "file");

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

  // The plugin's tools are registered globally, but a request served by
  // another provider must not receive them. A session that switched away from
  // free-pi loses them on the next request, like it loses the headers.
  const freeTools = {
    look_at_image: { description: "", input: {} },
    free_pi_usage: { description: "", input: {} },
    web_search: { description: "", input: {} },
    docs_lookup: { description: "", input: {} },
    generate_image: { description: "", input: {} },
    read: { description: "", input: {} },
  };
  const otherModel = await invokeGlobal("context", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "anthropic", id: "claude-sonnet" },
    system: [],
    messages: [userMessage],
    options: {},
    tools: structuredClone(freeTools),
  });
  assert.deepEqual(Object.keys(otherModel.tools), ["read"]);

  // A free-pi request keeps every tool.
  const freeModel = await invokeGlobal("context", {
    sessionID: "ses_parent",
    agent: "build",
    kind: "primary",
    model: { providerID: "free-pi", id: "hy4-flash" },
    system: [],
    messages: [userMessage],
    options: {},
    tools: structuredClone(freeTools),
  });
  assert.deepEqual(
    Object.keys(freeModel.tools).sort(),
    Object.keys(freeTools).sort(),
  );

  // `isFreePiSession` follows the current model, so a session that used
  // free-pi before and now runs another provider cannot call its tools.
  deps.state.freePiSessions.add("ses_switched");
  deps.state.trackedModels.set("ses_switched", {
    providerID: "anthropic",
    modelID: "claude-sonnet",
  });
  assert.equal(isFreePiSession(deps, "ses_switched"), false);
  deps.state.trackedModels.set("ses_switched", {
    providerID: "free-pi",
    modelID: "hy4-flash",
  });
  assert.equal(isFreePiSession(deps, "ses_switched"), true);

  // The unscoped model tracker records other providers too, so the gate flips
  // on the first request after a model switch.
  deps.state.freePiSessions.add("ses_tracked");
  await invokeGlobal("model.request", {
    sessionID: "ses_tracked",
    agent: "build",
    kind: "primary",
    model: { providerID: "nvidia", id: "gemma" },
    headers: {},
  });
  assert.equal(isFreePiSession(deps, "ses_tracked"), false);
  assert.deepEqual(deps.state.trackedModels.get("ses_tracked"), {
    providerID: "nvidia",
    modelID: "gemma",
  });

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
  assert.ok(
    !compactEvent.messages.some((message) =>
      (message.content ?? []).some(
        (part) =>
          typeof part.text === "string" &&
          part.text.startsWith(TURN_REMINDER_MARKER),
      ),
    ),
    "compaction requests do not carry the primary turn reminder",
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

  // A refused or dropped connection is retried beyond OpenCode's own budget,
  // because a brief network or service outage is not a provider limit. The
  // wire session id is marked dirty so the next attempt gets a fresh slot.
  const refused = await invoke("retry", "free-pi", {
    sessionID: "ses_refused",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: {
      type: "provider.transport",
      message:
        "ECONNREFUSED: Unable to connect. Is the computer able to access the url?",
    },
    attempt: 2,
    decision: { retry: false },
  });
  assert.deepEqual(refused.decision, { retry: true, delay: 2_000 });
  assert.equal(deps.state.dirtySessions.has("ses_refused"), true);
  const lateRetry = await invoke("retry", "free-pi", {
    sessionID: "ses_refused",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { type: "provider.transport", message: "socket hang up" },
    attempt: 5,
    decision: { retry: false },
  });
  assert.equal(lateRetry.decision.retry, true);
  assert.equal(lateRetry.decision.delay, 16_000);
  const refusedOut = await invoke("retry", "free-pi", {
    sessionID: "ses_refused",
    agent: "build",
    model: { providerID: "free-pi", id: "hy4-flash" },
    error: { type: "provider.transport", message: "ECONNREFUSED" },
    attempt: 7,
    decision: { retry: true },
  });
  assert.deepEqual(refusedOut.decision, { retry: false });

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

    // The size the gateway refused is a hard ceiling for that model: the next
    // catalog build advertises a window below it, and the provider is reloaded
    // so this process uses it without a restart.
    const live = await import("../dist/catalog/live.js");
    const ceiling = live.learnedContextWindow(
      live.currentLiveLimits(),
      "hy4-flash",
    );
    assert.ok(ceiling && ceiling < 100_000, String(ceiling));
    assert.equal(reloads > 0, true);
  }

  // A compaction request larger than the learned ceiling drops the oldest user
  // turns, because OpenCode ends the turn when its summarizer request is
  // refused. The compaction keeps OpenCode's own output budget.
  {
    const big = (id) => ({
      id,
      role: "user",
      content: [{ type: "text", text: "y".repeat(200_000) }],
    });
    const newest = {
      id: "m_newest",
      role: "user",
      content: [{ type: "text", text: "keep me" }],
    };
    const trimEvent = await invoke("compaction", "free-pi", {
      sessionID: "ses_trim",
      agent: "build",
      kind: "compaction",
      model: { providerID: "free-pi", id: "hy4-flash" },
      system: [],
      messages: [big("m_old"), big("m_mid"), newest],
      options: { maxTokens: 1_000_000 },
    });
    assert.ok(trimEvent.messages.length < 3, String(trimEvent.messages.length));
    assert.equal(trimEvent.messages.at(-1).id, "m_newest");
    assert.equal(
      trimEvent.options.maxTokens,
      1_000_000,
      "the compaction output budget is left to OpenCode",
    );
  }

  // The compaction request quotes the newest turns from the native session:
  // OpenCode keeps only the last exchange beside the summary, so those turns
  // would otherwise vanish right after a compaction.
  {
    const previousRead = deps.readContext;
    const reads = [];
    deps.readContext = async (sessionID) => {
      reads.push(sessionID);
      return [
        {
          id: "m_recent_user",
          type: "user",
          role: "user",
          content: [{ type: "text", text: "arregla la compactación" }],
        },
        {
          id: "m_recent_assistant",
          type: "assistant",
          role: "assistant",
          content: [
            {
              type: "text",
              text: "OpenCode conserva solo el último intercambio",
            },
          ],
        },
      ];
    };
    try {
      const windowEvent = {
        sessionID: "ses_window",
        agent: "build",
        kind: "compaction",
        model: { providerID: "free-pi", id: "hy4-flash" },
        system: [],
        messages: [
          {
            id: "m_flat",
            role: "user",
            content: [{ type: "text", text: "flattened transcript" }],
          },
        ],
        options: {},
      };
      await invoke("compaction", "free-pi", windowEvent);
      assert.deepEqual(reads, ["ses_window"]);
      const blocks = windowEvent.system.filter(
        (part) =>
          typeof part.text === "string" &&
          part.text.startsWith(RECENT_WINDOW_MARKER),
      );
      assert.equal(blocks.length, 1, "the recent window is added once");
      assert.match(blocks[0].text, /arregla la compactación/);
      assert.match(blocks[0].text, /## Recent window/);
      assert.equal(
        windowEvent.system.some((part) =>
          part.text.startsWith(FREE_PI_COMPACTION_MARKER),
        ),
        true,
        "the summary rules are still present",
      );
      // Free models ignore a block buried in the system prompt, so the window
      // also closes the conversation.
      const closing = windowEvent.messages.at(-1);
      assert.equal(closing.role, "user");
      assert.match(closing.content[0].text, /^# free-pi recent window/);
      assert.match(closing.content[0].text, /arregla la compactación/);

      // The same event reused by OpenCode must not duplicate the block.
      await invoke("compaction", "free-pi", windowEvent);
      assert.equal(
        windowEvent.system.filter((part) =>
          part.text.startsWith(RECENT_WINDOW_MARKER),
        ).length,
        1,
      );

      // The first request after the compaction carries that window once, so the
      // newest work is visible even if the summary compressed it.
      const nextTurn = () => ({
        sessionID: "ses_window",
        agent: "build",
        kind: "primary",
        model: { providerID: "free-pi", id: "hy4-flash" },
        system: [],
        messages: [
          {
            id: `m_next_${Math.random().toString(36).slice(2, 7)}`,
            role: "user",
            content: [{ type: "text", text: "continúa" }],
          },
        ],
        options: {},
      });
      const first = nextTurn();
      await invoke("context", "free-pi", first);
      const carried = first.system.filter(
        (part) =>
          typeof part.text === "string" &&
          part.text.startsWith(RECENT_WINDOW_CARRY_MARKER),
      );
      assert.equal(carried.length, 1, "the window is carried once");
      assert.match(carried[0].text, /arregla la compactación/);

      const second = nextTurn();
      await invoke("context", "free-pi", second);
      assert.equal(
        second.system.filter((part) =>
          part.text.startsWith(RECENT_WINDOW_CARRY_MARKER),
        ).length,
        0,
        "the window is not carried twice",
      );

      // OpenCode can hand the same event to the compaction hook and then to the
      // primary one. The summary rules must not survive: the model would read
      // them as an order to answer with "## Objective / ## Work State" and burn
      // the turn writing a checkpoint instead of doing the work.
      deps.readContext = async () => [];
      const reuseEvent = {
        sessionID: "ses_reuse",
        agent: "build",
        kind: "compaction",
        model: { providerID: "free-pi", id: "hy4-flash" },
        system: [{ type: "text", text: "OpenCode system prompt" }],
        messages: [
          {
            id: "m_reuse",
            role: "user",
            content: [{ type: "text", text: "sigue con el tema oscuro" }],
          },
        ],
        options: {},
      };
      const originalSystem = reuseEvent.system;
      await invoke("compaction", "free-pi", reuseEvent);
      assert.notEqual(
        reuseEvent.system,
        originalSystem,
        "the system array is replaced instead of mutated in place",
      );
      assert.equal(
        reuseEvent.system.some((part) =>
          part.text.startsWith(FREE_PI_COMPACTION_MARKER),
        ),
        true,
      );
      reuseEvent.kind = "primary";
      await invoke("context", "free-pi", reuseEvent);
      assert.equal(
        reuseEvent.system.some((part) =>
          part.text.startsWith(FREE_PI_COMPACTION_MARKER),
        ),
        false,
        "the compaction rules are stripped from the primary turn",
      );
      assert.equal(
        reuseEvent.system.some((part) =>
          part.text.startsWith("# free-pi working rules"),
        ),
        true,
        "the working rules are present",
      );

      // A window older than an hour is dropped: the summary is the history by
      // then, and a stale quote would only spend tokens.
      deps.state.recentWindows.set("ses_stale", {
        at: Date.now() - 2 * 60 * 60_000,
        text: "[user]\nviejo",
      });
      const stale = nextTurn();
      stale.sessionID = "ses_stale";
      await invoke("context", "free-pi", stale);
      assert.equal(
        stale.system.some((part) =>
          part.text.startsWith(RECENT_WINDOW_CARRY_MARKER),
        ),
        false,
      );
      assert.equal(deps.state.recentWindows.has("ses_stale"), false);
    } finally {
      deps.readContext = previousRead;
    }
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

  // A long primary request keeps its turns and instructions but collapses
  // stale tool payloads, so the free models stay inside the range where they
  // still follow the working rules.
  {
    deps.state.contextLimits.set("free-pi/hy4-flash", 200_000);
    const dietMessages = [
      { role: "user", content: [{ type: "text", text: "corrige el parser" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            id: "t1",
            name: "read",
            result: { type: "text", value: "a".repeat(400_000) },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "confirmado" }] },
      { role: "user", content: [{ type: "text", text: "aplica el cambio" }] },
    ];
    const dietEvent = await invoke("context", "free-pi", {
      sessionID: "ses_diet",
      agent: "build",
      kind: "primary",
      model: { providerID: "free-pi", id: "hy4-flash" },
      system: [],
      messages: dietMessages,
      options: {},
    });
    assert.equal(dietEvent.messages.length, dietMessages.length + 1);
    assert.deepEqual(dietEvent.messages[0], dietMessages[0]);
    assert.deepEqual(dietEvent.messages[2], dietMessages[2]);
    assert.deepEqual(dietEvent.messages[3], dietMessages[3]);
    assert.match(
      dietEvent.messages[1].content[0].result.value,
      /characters of this tool result were pruned/,
    );
    assert.ok(
      infos.some((entry) =>
        /pruned stale tool results/i.test(entry.message),
      ),
      "the diet is logged",
    );

    // Already inside the budget: the list is left untouched.
    const smallMessages = [
      { role: "user", content: "hola" },
      { role: "tool", tool_call_id: "t1", content: "salida" },
    ];
    const smallEvent = await invoke("context", "free-pi", {
      sessionID: "ses_diet_small",
      agent: "build",
      kind: "primary",
      model: { providerID: "free-pi", id: "hy4-flash" },
      system: [],
      messages: smallMessages,
      options: {},
    });
    assert.equal(smallEvent.messages.length, smallMessages.length + 1);
    assert.deepEqual(smallEvent.messages.slice(0, 2), smallMessages);

    // Requests served by another provider are never pruned.
    const foreignEvent = await invokeGlobal("context", {
      sessionID: "ses_foreign",
      kind: "primary",
      model: { providerID: "nvidia", id: "gemma" },
      system: [],
      messages: dietMessages,
      options: {},
    });
    assert.equal(foreignEvent.messages, dietMessages);
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
    (entry) =>
      !/compact loop stopped/i.test(entry.message) &&
      !/lowering the advertised window/i.test(entry.message) &&
      !/trimmed the compaction request/i.test(entry.message) &&
      !/could not be reached; retrying/i.test(entry.message),
  );
  assert.equal(unexpected.length, 0, JSON.stringify(warnings));
  console.log("ok");
} finally {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
}
