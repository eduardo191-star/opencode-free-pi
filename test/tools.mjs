import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "freepi-tools-"));
process.env.FREE_PI_DATA_DIR = dir;
process.env.FREEPI_CREDENTIALS_PATH = join(dir, "missing-credentials.json");
process.env.FREEPI_BASE_URL = "https://api.test";
process.env.OPENCODE_HEADLESS = "1";
delete process.env.FREEPI_JWT;

const { createRuntimeState } = await import("../dist/state.js");
const { formatUsage, registerUsageTool } = await import(
  "../dist/tools/usage.js"
);
const { formatWebResults, registerWebTools } = await import(
  "../dist/tools/web.js"
);
const { registerGenerateImageTool, slug } = await import(
  "../dist/tools/image-generate.js"
);
const { formatTranscript, registerSubagentTool } = await import(
  "../dist/tools/subagent.js"
);

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const requests = [];
let mode = "ok";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input.href : input);
  requests.push({
    url,
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  });
  if (mode === "daily_cap") {
    return new Response(
      JSON.stringify({ error: { code: "daily_cap", message: "no credits" } }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
  }
  if (url.endsWith("/me/stats")) {
    return Response.json({
      tier: "free",
      credit_credits: 1200,
      remaining_credits_today: 3400,
      allowance_credits: 5000,
      refill_at: "2026-11-22T05:00:00.000Z",
      lane: "normal",
      bonus_wallet_credits: 0,
      prompt_tokens_today: 1234,
      completion_tokens_today: 567,
      lifetime: { prompt_tokens: 98765, completion_tokens: 4321 },
      guest: false,
    });
  }
  if (url.endsWith("/me")) {
    return Response.json({ buy_url: "https://freepi.ai/extra-credits" });
  }
  if (url.endsWith("/tools/web-search")) {
    return Response.json({
      cost_usd: 0.002,
      results: [
        {
          title: "Vite 6",
          url: "https://vite.dev/blog/vite-6",
          published_date: "2026-01-01",
          text: "Vite 6 release notes",
        },
      ],
    });
  }
  if (url.endsWith("/tools/docs")) {
    return Response.json({
      title: "Next.js",
      library_id: "/vercel/next.js",
      docs: "Middleware matcher docs",
      cost_usd: 0.001,
    });
  }
  if (url.endsWith("/tools/image")) {
    return Response.json({
      image_b64: TINY_PNG.toString("base64"),
      media_type: "image/png",
      cost_usd: 0.02,
      model: "image-test",
    });
  }
  return Response.json({});
};

const log = {
  log() {},
  info() {},
  warn() {},
  error() {},
};

const childMessages = [
  {
    id: "m1",
    type: "user",
    text: "List the files in src and report the count.",
  },
  {
    id: "m2",
    type: "assistant",
    agent: "free-pi/scout",
    finish: "tool-calls",
    content: [
      { type: "reasoning", text: "hidden" },
      {
        type: "tool",
        name: "glob",
        state: {
          status: "completed",
          input: { pattern: "src/**/*.ts" },
          content: [{ type: "text", text: "src/a.ts\nsrc/b.ts" }],
        },
      },
      { type: "text", text: "There are two TypeScript files." },
    ],
  },
];
const sessions = new Map([
  [
    "child1",
    {
      id: "child1",
      parentID: "s1",
      title: "Count files",
      agent: "free-pi/scout",
      outcome: "succeeded",
      updated: Date.now(),
    },
  ],
  [
    "stranger",
    { id: "stranger", parentID: "someone-else", title: "Not a child" },
  ],
]);

const deps = {
  state: createRuntimeState(),
  log,
  activeCredential: async () => ({
    type: "key",
    key: "test-token",
    metadata: { expires: String(Date.now() + 3_600_000) },
  }),
  readContext: async (sessionID) =>
    sessionID === "child1" ? childMessages : [],
  readSession: async (sessionID) => sessions.get(sessionID),
  listSubagentSessions: async (parentID) =>
    [...sessions.values()].filter((session) => session.parentID === parentID),
};
deps.state.freePiSessions.add("s1");

const tools = new Map();
const ctx = {
  location: { directory: dir },
  tool: {
    transform: async (callback) => {
      callback({
        add(tool) {
          tools.set(tool.name, tool);
        },
      });
      return { dispose: async () => {} };
    },
  },
};

await registerUsageTool(ctx, deps);
await registerWebTools(ctx, deps);
await registerGenerateImageTool(ctx, deps);
await registerSubagentTool(ctx, deps);

const signal = new AbortController().signal;
const freeContext = { sessionID: "s1", signal };
const otherContext = { sessionID: "other", signal };

const call = async (name, input, context = freeContext) => {
  const tool = tools.get(name);
  assert.ok(tool, `${name} is registered`);
  return tool.execute(input, context);
};

assert.deepEqual(
  [...tools.keys()].sort(),
  [
    "docs_lookup",
    "free_pi_subagent_read",
    "free_pi_usage",
    "generate_image",
    "web_search",
  ],
);

// Every tool is gated to free-pi sessions.
for (const [name, input] of [
  ["free_pi_usage", {}],
  ["free_pi_subagent_read", { sessionID: "child1" }],
  ["web_search", { query: "vite" }],
  ["docs_lookup", { library: "next.js", query: "matcher" }],
  ["generate_image", { prompt: "a cat" }],
]) {
  const denied = await call(name, input, otherContext);
  assert.equal(denied.metadata.ok, false, `${name} is gated`);
  assert.match(denied.content[0].text, /only available in free-pi sessions/);
}

const usage = await call("free_pi_usage", {});
assert.equal(usage.metadata.ok, true);
assert.match(usage.content[0].text, /^tier: free/);
assert.match(usage.content[0].text, /3,400 \/ 5,000 credits left today/);
assert.match(usage.content[0].text, /today tokens: 1234 prompt \/ 567 completion/);
assert.doesNotMatch(usage.content[0].text, /Buy credits:/);
assert.doesNotMatch(usage.content[0].text, /low credits:/);

// The parent can read what a child subagent actually ran and quote its answer.
const child = await call("free_pi_subagent_read", { sessionID: "child1" });
assert.equal(child.metadata.ok, true);
assert.match(child.content[0].text, /Subagent session child1 - Count files/);
assert.match(child.content[0].text, /\[user\][\s\S]*List the files in src/);
assert.match(child.content[0].text, /\[tool glob\] completed/);
assert.match(child.content[0].text, /"pattern": "src\/\*\*\/\*\.ts"/);
assert.match(child.content[0].text, /src\/a\.ts/);
assert.match(child.content[0].text, /There are two TypeScript files\./);
assert.doesNotMatch(child.content[0].text, /hidden/);
assert.equal(child.metadata.agent, "free-pi/scout");
assert.equal(child.metadata.outcome, "succeeded");
assert.equal(child.metadata.messages, 2);

// Another session's transcript is refused, even with a valid id.
const stranger = await call("free_pi_subagent_read", { sessionID: "stranger" });
assert.equal(stranger.metadata.ok, false);
assert.match(stranger.content[0].text, /not a subagent of this session/);
const missing = await call("free_pi_subagent_read", { sessionID: "nope" });
assert.equal(missing.metadata.ok, false);
assert.match(missing.content[0].text, /No OpenCode session with id nope/);

// Without an id the tool lists this session's children, never other sessions.
const listing = await call("free_pi_subagent_read", {});
assert.equal(listing.metadata.ok, true);
assert.equal(listing.metadata.children, 1);
assert.match(listing.content[0].text, /child1 - Count files/);
assert.doesNotMatch(listing.content[0].text, /stranger/);

// Long transcripts keep the newest turns and say what was dropped.
const long = formatTranscript(
  [
    { type: "user", text: "a".repeat(4_000) },
    { type: "user", text: "b".repeat(4_000) },
    { type: "assistant", content: [{ type: "text", text: "final answer" }] },
  ],
  2_500,
);
assert.equal(long.truncated, true);
assert.match(long.text, /older transcript block/);
assert.match(long.text, /final answer/);

// Low allowance warns once and points at the credit page.
const lowUsage = formatUsage({
  tier: "free",
  remaining_credits_today: 400,
  allowance_credits: 5000,
  refill_at: "2026-11-22T05:00:00.000Z",
  buy_url: "https://freepi.ai/extra-credits",
  prompt_tokens_today: 0,
  completion_tokens_today: 0,
  lifetime: {},
});
assert.match(lowUsage, /low credits: 8% of today's allowance left/);
assert.match(lowUsage, /Buy credits: https:\/\/freepi\.ai\/extra-credits/);

// The same page is offered once the allowance is gone.
const emptyUsage = formatUsage({
  tier: "free",
  remaining_credits_today: 0,
  allowance_credits: 5000,
  refill_at: "2026-11-22T05:00:00.000Z",
  buy_url: "https://freepi.ai/extra-credits",
  prompt_tokens_today: 0,
  completion_tokens_today: 0,
  lifetime: {},
});
assert.match(emptyUsage, /Out of free credits today/);
assert.match(emptyUsage, /Buy credits: https:\/\/freepi\.ai\/extra-credits/);
assert.doesNotMatch(emptyUsage, /low credits:/);

const formatted = formatUsage({
  tier: "free",
  spent_usd_today: 2,
  cap_usd_today: 4,
  prompt_tokens_today: 0,
  completion_tokens_today: 0,
  lifetime: {},
});
assert.match(formatted, /50% of your free daily allowance used/);

const web = await call("web_search", { query: "vite 6", num_results: 3 });
assert.equal(web.metadata.ok, true);
assert.match(web.content[0].text, /Web results for "vite 6"/);
assert.match(web.content[0].text, /https:\/\/vite.dev\/blog\/vite-6/);
assert.equal(web.metadata.cost_usd, 0.002);
const webRequest = requests.find((r) => r.url.endsWith("/tools/web-search"));
assert.deepEqual(webRequest.body, { query: "vite 6", num_results: 3 });
assert.equal(webRequest.headers.authorization, "Bearer test-token");

// Every call reaches the server; the plugin never reuses an earlier answer.
const webCalls = () =>
  requests.filter((r) => r.url.endsWith("/tools/web-search")).length;
const beforeRepeat = webCalls();
const repeated = await call("web_search", { query: "vite 6", num_results: 3 });
assert.equal(repeated.metadata.ok, true);
assert.equal(repeated.metadata.cached, undefined);
assert.equal(repeated.metadata.cost_usd, 0.002);
assert.equal(webCalls(), beforeRepeat + 1);

// A different query is a new search.
const afterRepeat = webCalls();
await call("web_search", { query: "vite 7", num_results: 3 });
assert.equal(webCalls(), afterRepeat + 1);

const lookup = await call("docs_lookup", {
  library: "next.js",
  query: "matcher",
});
assert.equal(lookup.metadata.library_id, "/vercel/next.js");
assert.match(lookup.content[0].text, /Next\.js \(library_id: \/vercel\/next\.js\)/);
assert.match(lookup.content[0].text, /Middleware matcher docs/);

const docsCalls = () =>
  requests.filter((r) => r.url.endsWith("/tools/docs")).length;
const beforeDocs = docsCalls();
const lookupAgain = await call("docs_lookup", {
  library: "next.js",
  query: "matcher",
});
assert.equal(lookupAgain.metadata.cached, undefined);
assert.equal(docsCalls(), beforeDocs + 1);

assert.equal(
  formatWebResults("nothing", []),
  'No results for "nothing". Try a broader or differently worded query.',
);

mode = "daily_cap";
const limited = await call("web_search", { query: "vite" });
assert.equal(limited.metadata.ok, false);
assert.match(limited.content[0].text, /daily free usage is used up/);
mode = "ok";

const image = await call("generate_image", { prompt: "A cat", name: "Cat Hero" });
assert.equal(image.metadata.ok, true);
assert.match(image.metadata.path, /^images\/cat-hero-[0-9a-f]{6}\.png$/);
const saved = await readFile(join(dir, image.metadata.path));
assert.equal(saved.equals(TINY_PNG), true);
assert.equal((await stat(join(dir, image.metadata.path))).isFile(), true);
assert.equal(slug("  Héroe del gato!! "), "h-roe-del-gato");

globalThis.fetch = realFetch;
await rm(dir, { recursive: true, force: true });
console.log("tools ok");
