import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(tmpdir(), `freepi-catalog-${process.pid}`);
process.env.FREE_PI_DATA_DIR = dir;
process.env.FREEPI_BASE_URL = "https://freepi.test";

const { createRuntimeState } = await import("../dist/state.js");
const { fetchCatalog, refreshCatalog } = await import(
  "../dist/catalog/catalog.js"
);

function makeDeps(state) {
  const infos = [];
  const warnings = [];
  return {
    infos,
    warnings,
    deps: {
      state,
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
      activeCredential: async () => undefined,
      readContext: async () => [],
    },
  };
}

const catalog = {
  latest: "0.6.27",
  default_model: "deepseek-v4.1-flash",
  models: {
    "deepseek-v4.1-flash": { name: "DeepSeek V4.1 Flash", free: true },
  },
};
const realFetch = globalThis.fetch;
let calls = 0;

try {
  // A transient failure is retried before the plugin decides the catalog is
  // gone; otherwise the provider would be registered with zero models and the
  // picker would hide every free-pi entry for that location.
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error("network down");
    return new Response(JSON.stringify(catalog), { status: 200 });
  };
  const first = makeDeps(createRuntimeState());
  assert.deepEqual(await refreshCatalog(first.deps), catalog);
  assert.equal(calls, 2);
  assert.equal(first.warnings.length, 0);
  assert.equal(first.infos.length, 1);
  assert.match(first.infos[0].message, /retrying/);
  assert.deepEqual(first.deps.state.cachedCatalog, catalog);
  assert.equal(first.deps.state.latestClientVersion, "0.6.27");

  // A fresh in-memory catalog is reused without another request.
  const before = calls;
  assert.deepEqual(await fetchCatalog(first.deps), catalog);
  assert.equal(calls, before);

  // When every attempt fails and nothing is cached, the caller gets undefined
  // and a single warning explains that no models were registered.
  const second = makeDeps(createRuntimeState());
  globalThis.fetch = async () => {
    calls += 1;
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  };
  const failedAt = calls;
  assert.equal(await refreshCatalog(second.deps), undefined);
  assert.equal(calls, failedAt + 2);
  assert.equal(second.warnings.length, 1);
  assert.match(second.warnings[0].message, /no free-pi models were registered/);
  assert.equal(second.warnings[0].extra.reason, "request timed out");

  // A stale cache keeps serving models instead of emptying the provider.
  const third = makeDeps(createRuntimeState());
  third.deps.state.cachedCatalog = catalog;
  third.deps.state.cachedCatalogAt = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network down");
  };
  assert.deepEqual(await fetchCatalog(third.deps), catalog);
  assert.equal(third.warnings.length, 1);
  assert.match(third.warnings[0].message, /cached model list/);

  console.log("ok");
} finally {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
}
