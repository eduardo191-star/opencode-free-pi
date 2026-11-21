import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "freepi-registry-"));
process.env.FREE_PI_CACHE_DIR = dir;
process.env.FREEPI_MODELS_URL = "https://models.test";

const { readCache, writeCache } = await import("../dist/utils/cache.js");
const { createRuntimeState } = await import("../dist/state.js");
const { fetchModelsRegistry } = await import("../dist/catalog/registry.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeDeps(state) {
  const warnings = [];
  return {
    warnings,
    deps: {
      state,
      log: {
        log() {},
        info() {},
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

const registry = { example: { models: { model: { name: "Example" } } } };
const realFetch = globalThis.fetch;
let calls = 0;

try {
  // 1. Disk cache round trip.
  await writeCache("roundtrip.json", { a: 1 });
  assert.deepEqual(await readCache("roundtrip.json", 10_000), { a: 1 });
  assert.equal(await readCache("roundtrip.json", -1), undefined);

  // 2. A successful fetch populates memory and disk.
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(registry), { status: 200 });
  };
  const first = makeDeps(createRuntimeState());
  assert.deepEqual(await fetchModelsRegistry(first.deps), registry);
  assert.equal(calls, 1);
  assert.deepEqual(first.deps.state.cachedRegistry, registry);
  await sleep(50);

  // 3. A fresh instance falls back to the disk cache when the network fails.
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network down");
  };
  const second = makeDeps(createRuntimeState());
  assert.deepEqual(await fetchModelsRegistry(second.deps), registry);
  await sleep(1_000); // Let the background refresh finish and report once.
  assert.equal(second.warnings.length, 1);
  assert.match(second.warnings[0].message, /cached model metadata/);

  // 4. With no cache the failure is reported and retried at most once per window.
  await rm(join(dir, "models-dev.json"), { force: true });
  const third = makeDeps(createRuntimeState());
  assert.equal(await fetchModelsRegistry(third.deps), undefined);
  assert.equal(third.warnings.length, 1);
  assert.match(third.warnings[0].message, /fall back to defaults/);
  const attempts = calls;
  assert.equal(await fetchModelsRegistry(third.deps), undefined);
  assert.equal(calls, attempts, "negative cache should skip the second request");

  console.log("ok");
} finally {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
}
