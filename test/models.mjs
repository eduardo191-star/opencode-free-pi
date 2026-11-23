import assert from "node:assert/strict";

const { buildModels, modelVariants } = await import("../dist/catalog/models.js");
const { accountAccess, filterAccessibleModels } = await import(
  "../dist/catalog/models.js"
);
const { toV2Models } = await import("../dist/catalog/v2.js");
const { CONTEXT_WINDOW, MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_CEILING, CREDITS_PER_USD } = await import(
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
// The free models were probed calling tools, so a models.dev entry for the
// upstream alias cannot remove their tools. Without tools OpenCode would also
// hide its native `subagent` tool.
assert.equal(free.tool_call, true);
assert.equal(free.attachment, true);
assert.equal(free.temperature, false);
assert.deepEqual(free.limit, { context: 123_456, output: 4_096 });
assert.deepEqual(free.modalities, {
  input: ["text", "image"],
  output: ["text"],
});
assert.deepEqual(free.variants, {
  none: { reasoningEffort: "none" },
  minimal: { reasoningEffort: "minimal" },
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  max: { reasoningEffort: "max" },
});
// The picker reads the same complete level list the plugin can send.
assert.deepEqual(free.reasoning_options, [
  {
    type: "effort",
    values: ["none", "minimal", "low", "medium", "high", "max"],
  },
]);
// The CLI's levels are always advertised and `medium` is the default; leaving
// the effort unset made free models answer before thinking.
assert.deepEqual(free.settings, { reasoningEffort: "high" });
assert.equal(free.enabled, true);

// free-pi's free models were probed against the live gateway: every one of them
// transcribes an attached screenshot, even when models.dev has no entry for the
// alias, so image input is always advertised for them.
const freeNoRegistry = buildModels(
  [{ id: "particle", display_name: "Particle", free: true }],
  [],
)["particle"];
assert.deepEqual(freeNoRegistry.modalities, {
  input: ["text", "image"],
  output: ["text"],
});
assert.equal(freeNoRegistry.attachment, true);

// Paid aliases without a models.dev match stay text-only until the gateway is
// probed for them, so the picker never promises an unsupported attachment.
const paidNoRegistry = buildModels(
  [{ id: "paid-alias", display_name: "Paid Alias" }],
  [],
)["paid-alias"];
assert.deepEqual(paidNoRegistry.modalities, {
  input: ["text"],
  output: ["text"],
});
assert.equal(paidNoRegistry.attachment, false);

// A multimodal upstream is advertised with image input even when models.dev
// omits the `attachment` flag, and image output is never advertised.
const multimodal = buildModels(
  [{ id: "multi", display_name: "Multi" }],
  [
    {
      providerID: "vendor",
      modelID: "multi",
      model: {
        name: "Multi",
        modalities: { input: ["text", "image"], output: ["image"] },
      },
    },
  ],
)["multi"];
assert.equal(multimodal.attachment, true);
assert.deepEqual(multimodal.modalities, {
  input: ["text", "image"],
  output: ["text"],
});

// Unknown modality values are dropped instead of confusing the picker.
const odd = buildModels(
  [{ id: "odd", display_name: "Odd" }],
  [
    {
      providerID: "vendor",
      modelID: "odd",
      model: { name: "Odd", modalities: { input: ["image", "hologram"] } },
    },
  ],
)["odd"];
assert.deepEqual(odd.modalities.input, ["text", "image"]);

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
// A paid alias keeps models.dev's tool capability, and free-pi's own catalog
// wins when it explicitly disables tools for a free model.
assert.equal(registryCost.tool_call, false);
const freeExplicit = buildModels([
  { id: "explicit-free", display_name: "Explicit Free", free: true, tool_call: false },
])["explicit-free"];
assert.equal(freeExplicit.tool_call, false);

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
  output: MAX_OUTPUT_TOKENS_CEILING,
});

// Every reasoning model exposes the CLI's levels; catalog-specific ones such as
// `max` are added on top.
const cliLevels = {
  none: { reasoningEffort: "none" },
  minimal: { reasoningEffort: "minimal" },
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  max: { reasoningEffort: "max" },
};
assert.deepEqual(modelVariants([{ type: "toggle" }], 8_192), cliLevels);
assert.deepEqual(
  modelVariants(
    [
      { type: "toggle" },
      { type: "effort", values: ["low", "medium", "high"] },
    ],
    8_192,
  ),
  cliLevels,
);
// Budget-style options add their top level, but OpenCode's openai-compatible
// route only forwards `reasoning_effort`; the budget fields would be inert.
assert.deepEqual(
  modelVariants([{ type: "budget_tokens", min: 1_000, max: 1_000_000 }], 8_192),
  { ...cliLevels, max: { reasoningEffort: "max" } },
);
// Without catalog options the same CLI set applies.
assert.deepEqual(modelVariants(undefined, 8_192), cliLevels);

// The default effort is `medium` for every model, because an unset effort made
// the free models skip planning altogether. Budget-style catalogs use `high`.
const { preferredReasoningEffort, isReasoningEffort } = await import(
  "../dist/catalog/models.js"
);
assert.equal(preferredReasoningEffort(undefined), "high");
assert.equal(
  preferredReasoningEffort([{ type: "effort", values: ["low", "high"] }]),
  "high",
);
assert.equal(preferredReasoningEffort([{ type: "toggle" }]), "high");
assert.equal(
  preferredReasoningEffort([{ type: "budget_tokens", min: 1, max: 2 }]),
  "high",
);
assert.equal(preferredReasoningEffort(undefined, "low"), "low");
assert.equal(preferredReasoningEffort(undefined, false), undefined);
assert.equal(isReasoningEffort("medium"), true);
assert.equal(isReasoningEffort("xhigh"), false);

// The V2 projection keeps capabilities, variants, limits and cost tiers.
const [v2] = toV2Models("free-pi", { "free-model": free });
assert.equal(v2.providerID, "free-pi");
assert.equal(v2.capabilities.tools, true);
// Multimodal upstreams keep the image capability models.dev reports; the chat
// route never produces images, so output stays text.
assert.deepEqual(v2.capabilities.input, ["text", "image"]);
assert.deepEqual(v2.capabilities.output, ["text"]);
assert.equal(v2.capabilities.temperature, false);
assert.deepEqual(v2.settings, { reasoningEffort: "high" });
assert.deepEqual(v2.variants, [
  { id: "none", settings: { reasoningEffort: "none" } },
  { id: "minimal", settings: { reasoningEffort: "minimal" } },
  { id: "low", settings: { reasoningEffort: "low" } },
  { id: "medium", settings: { reasoningEffort: "medium" } },
  { id: "high", settings: { reasoningEffort: "high" } },
  { id: "max", settings: { reasoningEffort: "max" } },
]);
assert.deepEqual(v2.limit, { context: 123_456, output: 4_096 });
assert.deepEqual(v2.cost, [
  { input: 0, output: 0, cache: { read: 0, write: 0 } },
]);
assert.equal(v2.status, "active");
assert.equal(v2.enabled, true);
assert.equal(v2.time.released, 0);

// Models the server marks unavailable are disabled, not merely deprecated.
const unavailable = buildModels([
  { id: "gone", display_name: "Gone", unavailable: true },
])["gone"];
assert.equal(unavailable.enabled, false);
assert.equal(unavailable.status, "deprecated");
const [v2Gone] = toV2Models("free-pi", { gone: unavailable });
assert.equal(v2Gone.enabled, false);

// Only models the signed-in account can actually use are registered.
const catalogModels = [
  { id: "free-unlimited", free: true },
  { id: "allowance", free: false },
  { id: "premium", free: false, note: "premium credits" },
  { id: "gone", free: false, unavailable: true },
];
const broke = accountAccess({ remaining_credits_today: 0, credit_usd: 0 });
assert.deepEqual(
  filterAccessibleModels(catalogModels, broke).map((model) => model.id),
  ["free-unlimited"],
);
const allowance = accountAccess({ remaining_credits_today: 120 });
assert.deepEqual(
  filterAccessibleModels(catalogModels, allowance).map((model) => model.id),
  ["free-unlimited", "allowance"],
);
const premiumOnly = accountAccess({
  remaining_credits_today: 120,
  premium_bought_credits: 50,
});
assert.deepEqual(
  filterAccessibleModels(catalogModels, premiumOnly).map((model) => model.id),
  ["free-unlimited", "allowance", "premium"],
);
// With no quota snapshot we keep everything rather than hide usable models.
assert.deepEqual(
  filterAccessibleModels(catalogModels, undefined).map((model) => model.id),
  ["free-unlimited", "allowance", "premium"],
);

console.log("ok");
