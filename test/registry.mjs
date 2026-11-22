import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(tmpdir(), `freepi-registry-${process.pid}`);
process.env.FREE_PI_DATA_DIR = dir;
process.env.FREEPI_MODELS_URL = "https://models.test";

const { createRuntimeState } = await import("../dist/state.js");
const { fetchModelsRegistry } = await import("../dist/catalog/registry.js");

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
  // A successful fetch fills the in-memory registry and is reused within its TTL.
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(registry), { status: 200 });
  };
  const first = makeDeps(createRuntimeState());
  assert.deepEqual(await fetchModelsRegistry(first.deps), registry);
  assert.equal(calls, 1);
  assert.deepEqual(first.deps.state.cachedRegistry, registry);
  assert.deepEqual(await fetchModelsRegistry(first.deps), registry);
  assert.equal(calls, 1, "a fresh in-memory registry is reused");

  // Nothing is written to disk, so the next start always asks the server.
  assert.equal(existsSync(join(dir, "models-dev.json")), false);

  // A failure with no data is reported and retried at most once per window.
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network down");
  };
  const second = makeDeps(createRuntimeState());
  assert.equal(await fetchModelsRegistry(second.deps), undefined);
  assert.equal(second.warnings.length, 1);
  assert.match(second.warnings[0].message, /fall back to defaults/);
  const attempts = calls;
  assert.equal(await fetchModelsRegistry(second.deps), undefined);
  assert.equal(calls, attempts, "the retry window should skip the second request");

  // A failure after a good fetch keeps serving the in-memory registry.
  const third = makeDeps(createRuntimeState());
  third.deps.state.cachedRegistry = registry;
  third.deps.state.cachedRegistryAt = 0;
  assert.deepEqual(await fetchModelsRegistry(third.deps), registry);
  assert.equal(third.warnings.length, 1);
  assert.match(third.warnings[0].message, /cached model metadata/);

  console.log("ok");
} finally {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
}
