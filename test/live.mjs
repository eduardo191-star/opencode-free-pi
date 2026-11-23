import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "free-pi-live-"));
process.env.FREE_PI_DATA_DIR = dir;
await mkdir(dir, { recursive: true });
await writeFile(
  join(dir, "live-limits.json"),
  JSON.stringify({
    version: 1,
    window: { tokens: 180_000, verifiedAt: Date.now(), model: "probe" },
    models: {
      observed: { maxPromptTokens: 42_000, reasoning: true, updatedAt: 1 },
    },
  }),
  "utf8",
);

const live = await import("../dist/catalog/live.js");
const { buildModels } = await import("../dist/catalog/models.js");
const { CONTEXT_WINDOW } = await import("../dist/constants.js");

const limits = await live.loadLiveLimits();
assert.equal(limits.window.tokens, 180_000);
assert.equal(limits.models.observed.maxPromptTokens, 42_000);
assert.equal(limits.models.observed.reasoning, true);

// The verified window replaces the compiled one.
const measured = buildModels([{ id: "m", free: true }], [], { live: limits })[
  "m"
];
assert.equal(measured.limit.context, 180_000);

// A catalog field can only lower it; the gateway's measured ceiling wins over
// an optimistic upstream limit.
const published = buildModels(
  [{ id: "m", free: true, context_window: 1_000_000 }],
  [],
  { live: limits },
)["m"];
assert.equal(published.limit.context, 180_000);

const smaller = buildModels(
  [{ id: "m", free: true, context_window: 100_000 }],
  [],
  { live: limits },
)["m"];
assert.equal(smaller.limit.context, 100_000);

// Without measurements the compiled window still applies.
const plain = buildModels([{ id: "m", free: true }], [], {})["m"];
assert.equal(plain.limit.context, CONTEXT_WINDOW);

// Real traffic updates the in-memory record.
live.noteStepTokens({}, "observed", {
  input: 50_000,
  reasoning: 12,
  cache: { read: 1_000, write: 500 },
});
assert.equal(
  live.currentLiveLimits().models.observed.maxPromptTokens,
  51_500,
);
assert.equal(live.currentLiveLimits().models.observed.reasoning, true);

// Measurements are written back so the next start can use them.
await new Promise((resolve) => setTimeout(resolve, 2_300));
const persisted = JSON.parse(
  await readFile(join(dir, "live-limits.json"), "utf8"),
);
assert.equal(persisted.models.observed.maxPromptTokens, 51_500);

// A rejection is a hard ceiling: the advertised window stays below it, and a
// later, larger rejection does not raise it again.
const quiet = { log: { warn() {} } };
live.noteRejectedPrompt(quiet, "observed", 120_000);
assert.equal(
  live.currentLiveLimits().models.observed.rejectedPromptTokens,
  120_000,
);
assert.equal(
  live.learnedContextWindow(live.currentLiveLimits(), "observed"),
  102_000,
);
const clamped = buildModels([{ id: "observed", free: true }], [], {
  live: live.currentLiveLimits(),
})["observed"];
assert.equal(clamped.limit.context, 102_000);
live.noteRejectedPrompt(quiet, "observed", 200_000);
assert.equal(
  live.learnedContextWindow(live.currentLiveLimits(), "observed"),
  102_000,
);
// A model with no rejection keeps the measured window.
assert.equal(
  live.learnedContextWindow(live.currentLiveLimits(), "observed-other"),
  undefined,
);

// A fresh verification is trusted for a week; a missing or stale one is not.
assert.equal(live.shouldVerifyWindow(limits), false);
assert.equal(live.shouldVerifyWindow(undefined), true);
assert.equal(
  live.shouldVerifyWindow({
    version: 1,
    models: {},
    window: { tokens: 1, verifiedAt: 1 },
  }),
  true,
);

// The upward probe settles on the largest prompt the gateway accepted, with 3%
// headroom and a 1k rounding. Rejections never raise the value.
assert.equal(live.settleWindow([]), undefined);
assert.equal(live.settleWindow([{ chars: 900_000, tooLong: true }]), undefined);
assert.equal(
  live.settleWindow([
    { chars: 792_000, tokens: 147_000, tooLong: false },
    { chars: 1_020_000, tokens: 211_000, tooLong: false },
    { chars: 1_120_000, tooLong: true },
  ]),
  204_000,
);
assert.equal(
  live.settleWindow([{ chars: 1, tokens: 1_500_000, tooLong: false }]),
  1_000_000,
);
assert.equal(
  live.settleWindow([{ chars: 1, tokens: 10_000, tooLong: false }]),
  32_768,
);

// A window measured above the CLI's 200k is what the next start advertises.
const grown = buildModels([{ id: "m", free: true }], [], {
  live: {
    version: 1,
    models: {},
    window: { tokens: 204_000, verifiedAt: Date.now(), model: "probe" },
  },
})["m"];
assert.equal(grown.limit.context, 204_000);

console.log("live limits ok");
