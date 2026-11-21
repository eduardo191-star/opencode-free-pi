import assert from "node:assert/strict";

const { createRuntimeState } = await import("../dist/state.js");
const { spendOnce, SPEND_CACHE_TTL_MS } = await import(
  "../dist/tools/spend-cache.js"
);

const log = { log() {}, info() {}, warn() {}, error() {} };
const deps = {
  state: createRuntimeState(),
  log,
  activeCredential: async () => undefined,
  readContext: async () => [],
};

const ok = (text, metadata = {}) => ({
  content: [{ type: "text", text }],
  metadata: { ok: true, ...metadata },
});

let runs = 0;
const first = await spendOnce(deps, "k", async () => {
  runs += 1;
  return ok("answer", { cost_usd: 0.002 });
});
assert.equal(runs, 1);
assert.equal(first.metadata.cost_usd, 0.002);
assert.equal(first.metadata.cached, undefined);

const second = await spendOnce(deps, "k", async () => {
  runs += 1;
  return ok("answer", { cost_usd: 0.002 });
});
assert.equal(runs, 1, "the repeat never calls the server");
assert.equal(second.metadata.cached, true);
assert.equal(second.metadata.cost_usd, undefined);
assert.match(second.content[0].text, /answer/);
assert.match(second.content[0].text, /no allowance used/);

// Failures are never cached, so the next attempt sees the real error.
let failures = 0;
const failure = { content: [{ type: "text", text: "daily cap" }], metadata: { ok: false } };
await spendOnce(deps, "f", async () => {
  failures += 1;
  return failure;
});
await spendOnce(deps, "f", async () => {
  failures += 1;
  return failure;
});
assert.equal(failures, 2, "an error is retried");

// Concurrent identical calls share a single request.
let concurrent = 0;
const [a, b] = await Promise.all([
  spendOnce(deps, "c", async () => {
    concurrent += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return ok("together");
  }),
  spendOnce(deps, "c", async () => {
    concurrent += 1;
    return ok("together");
  }),
]);
assert.equal(concurrent, 1, "only one request is spent");
assert.equal(a.content[0].text, "together");
assert.equal(b.metadata.cached, true);

// Entries expire.
const entry = deps.state.toolSpend.get("k");
entry.at = Date.now() - SPEND_CACHE_TTL_MS - 1;
const refreshed = await spendOnce(deps, "k", async () => {
  runs += 1;
  return ok("fresh");
});
assert.equal(runs, 2, "an expired entry is fetched again");
assert.equal(refreshed.content[0].text, "fresh");

console.log("spend cache ok");
