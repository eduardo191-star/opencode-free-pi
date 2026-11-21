import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "freepi-tools-"));
process.env.FREE_PI_CACHE_DIR = dir;
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

const deps = {
  state: createRuntimeState(),
  log,
  activeCredential: async () => ({
    type: "key",
    key: "test-token",
    metadata: { expires: String(Date.now() + 3_600_000) },
  }),
  readContext: async () => [],
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
    "free_pi_usage",
    "generate_image",
    "web_search",
  ],
);

// Every tool is gated to free-pi sessions.
for (const [name, input] of [
  ["free_pi_usage", {}],
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
assert.doesNotMatch(usage.content[0].text, /buy more credits/);

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

const lookup = await call("docs_lookup", {
  library: "next.js",
  query: "matcher",
});
assert.equal(lookup.metadata.library_id, "/vercel/next.js");
assert.match(lookup.content[0].text, /Next\.js \(library_id: \/vercel\/next\.js\)/);
assert.match(lookup.content[0].text, /Middleware matcher docs/);

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
