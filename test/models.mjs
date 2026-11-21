import assert from "node:assert/strict";

const { buildModels, modelVariants } = await import("../dist/catalog/models.js");
const { toV2Models } = await import("../dist/catalog/v2.js");
const { CONTEXT_WINDOW, MAX_OUTPUT_TOKENS, CREDITS_PER_USD } = await import(
  "../dist/constants.js"
);

const registryModel = {
  name: "Free Model",
  reasoning: true,
  reasoning_options: [{ type: "effort", values: ["low", "high"] }],
  tool_call: false,
  attachment: true,
  temperature: false,
  limit: { context: 123_456, output: 4_096 },
  modalities: { input: ["text", "image"], output: ["text"] },
  cost: { input: 5, output: 10, cache_read: 1, cache_write: 2 },
};

// Free models ignore registry cost but inherit the other capabilities.
const free = buildModels(
  [
    {
      id: "free-model",
      display_name: "Free Model",
      free: true,
      stats_id: "vendor/free-model",
      input_credits_per_mtok: 999,
      output_credits_per_mtok: 999,
    },
  ],
  [{ providerID: "vendor", modelID: "free-model", model: registryModel }],
)["free-model"];

assert.deepEqual(free.cost, {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
});
assert.equal(free.tool_call, false);
assert.equal(free.attachment, true);
assert.equal(free.temperature, false);
assert.deepEqual(free.limit, { context: 123_456, output: 4_096 });
assert.deepEqual(free.modalities, {
  input: ["text", "image"],
  output: ["text"],
});
assert.deepEqual(free.variants, {
  low: { reasoningEffort: "low" },
  high: { reasoningEffort: "high" },
});

// free-pi bills in credits, not per-token USD, so every model reports zero
// cost just like the provider CLI's model registration.
const paid = buildModels(
  [
    {
      id: "paid-model",
      display_name: "Paid Model",
      input_credits_per_mtok: CREDITS_PER_USD * 2,
      output_credits_per_mtok: CREDITS_PER_USD * 8,
    },
  ],
  [],
)["paid-model"];
assert.deepEqual(paid.cost, {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
});
assert.deepEqual(paid.limit, {
  context: CONTEXT_WINDOW,
  output: MAX_OUTPUT_TOKENS,
});

const registryCost = buildModels(
  [{ id: "registry-cost", display_name: "Registry Cost" }],
  [
    {
      providerID: "vendor",
      modelID: "registry-cost",
      model: { name: "Registry Cost", ...registryModel },
    },
  ],
)["registry-cost"];
assert.deepEqual(registryCost.cost, {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
});

// A models.dev window larger than free-pi's real ceiling is clamped, so
// OpenCode compacts before the server rejects the request.
const oversized = buildModels(
  [{ id: "oversized", display_name: "Oversized" }],
  [
    {
      providerID: "vendor",
      modelID: "oversized",
      model: {
        name: "Oversized",
        limit: { context: 1_048_576, output: 131_072 },
      },
    },
  ],
)["oversized"];
assert.deepEqual(oversized.limit, {
  context: CONTEXT_WINDOW,
  output: MAX_OUTPUT_TOKENS,
});

// Variant shapes match the reasoning options.
assert.deepEqual(modelVariants([{ type: "toggle" }], 8_192), {
  none: { reasoningEffort: "none" },
  high: { reasoningEffort: "high" },
});
assert.deepEqual(
  modelVariants(
    [
      { type: "toggle" },
      { type: "effort", values: ["low", "medium", "high"] },
    ],
    8_192,
  ),
  {
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
  },
);
assert.deepEqual(
  modelVariants([{ type: "budget_tokens", min: 1_000, max: 1_000_000 }], 8_192),
  {
    high: {
      reasoningEffort: "high",
      thinking_budget: 3_584,
      thinking: { type: "enabled", budget_tokens: 3_584 },
    },
    max: {
      reasoningEffort: "max",
      thinking_budget: 7_168,
      thinking: { type: "enabled", budget_tokens: 7_168 },
    },
  },
);
assert.deepEqual(modelVariants(undefined, 8_192), {});

// The V2 projection keeps capabilities, variants, limits and cost tiers.
const [v2] = toV2Models("free-pi", { "free-model": free });
assert.equal(v2.providerID, "free-pi");
assert.equal(v2.capabilities.tools, false);
assert.deepEqual(v2.capabilities.input, ["text", "image"]);
assert.equal(v2.capabilities.temperature, false);
assert.deepEqual(v2.variants, [
  { id: "low", settings: { reasoningEffort: "low" } },
  { id: "high", settings: { reasoningEffort: "high" } },
]);
assert.deepEqual(v2.limit, { context: 123_456, output: 4_096 });
assert.deepEqual(v2.cost, [
  { input: 0, output: 0, cache: { read: 0, write: 0 } },
]);
assert.equal(v2.status, "active");
assert.equal(v2.enabled, true);
assert.equal(v2.time.released, 0);

console.log("ok");
