/** Turns the free-pi catalog and models.dev registry into model definitions. */

import {
  CONTEXT_WINDOW,
  MAX_OUTPUT_TOKENS,
} from "../constants.js";
import type {
  Catalog,
  CatalogModel,
  ModelDefinition,
  ModelRegistry,
  ModelsDevModel,
  ReasoningOption,
  RegistryCandidate,
} from "../types.js";
import { creditsToUsd, positiveNumber } from "../utils/numbers.js";
import { cleanText } from "../utils/text.js";

export type VariantMap = Record<string, Record<string, unknown>>;
export type ModelMap = Record<string, ModelDefinition>;

export function usableModels(catalog: Catalog | undefined): CatalogModel[] {
  return (catalog?.models ?? []).filter(
    (model) => typeof model.id === "string" && model.id.length > 0,
  );
}

export function partitionModels(catalog: Catalog | undefined): {
  main: CatalogModel[];
  defense: CatalogModel[];
} {
  const models = usableModels(catalog);
  const main = models.filter((model) => model.section !== "defense");
  const defense = models.filter((model) => model.section === "defense");
  if (main.length > 0) return { main, defense };
  if (
    typeof catalog?.default_model === "string" &&
    catalog.default_model.length > 0
  ) {
    return { main: [{ id: catalog.default_model }], defense };
  }
  return { main: [], defense };
}

export function displayName(model: CatalogModel): string {
  const base = model.display_name || model.name || model.id || "model";
  const tags: string[] = [];
  const lower = base.toLowerCase();
  if (model.free === true && !lower.includes("free")) tags.push("free");
  if (
    model.tier === "premium" &&
    !lower.includes("premium") &&
    !(model.note ?? "").toLowerCase().includes("premium")
  ) {
    tags.push("premium");
  }
  if (model.note && !lower.includes(model.note.toLowerCase()))
    tags.push(model.note);
  if (model.usage_x && !lower.includes(`${model.usage_x}x`)) {
    tags.push(`~${model.usage_x}x usage`);
  }
  return tags.length > 0 ? `${base} (${tags.join(" · ")})` : base;
}

export function modelCost(
  model: CatalogModel,
  capability?: ModelsDevModel,
): ModelDefinition["cost"] {
  const zero = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  if (model.free === true) return zero;
  const input =
    creditsToUsd(model.input_credits_per_mtok) ||
    positiveNumber(capability?.cost?.input) ||
    0;
  const output =
    creditsToUsd(model.output_credits_per_mtok) ||
    positiveNumber(capability?.cost?.output) ||
    0;
  if (input > 0 || output > 0) {
    return {
      input,
      output,
      cache_read:
        creditsToUsd(model.cache_read_credits_per_mtok) ||
        positiveNumber(capability?.cost?.cache_read) ||
        input,
      cache_write:
        creditsToUsd(model.cache_write_credits_per_mtok) ||
        positiveNumber(capability?.cost?.cache_write) ||
        input,
    };
  }
  return zero;
}

export function modelRegistryCandidates(
  registry: ModelRegistry | undefined,
): RegistryCandidate[] {
  const candidates: RegistryCandidate[] = [];
  for (const [providerID, provider] of Object.entries(registry ?? {})) {
    for (const [modelID, model] of Object.entries(provider?.models ?? {})) {
      if (model && typeof model === "object")
        candidates.push({ providerID, modelID, model });
    }
  }
  return candidates;
}

function normalizeModelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function capabilityScore(
  model: CatalogModel,
  candidate: RegistryCandidate,
): number {
  const id = model.id?.toLowerCase();
  const stats = model.stats_id?.toLowerCase();
  const candidateID = candidate.modelID.toLowerCase();
  const candidateName = cleanText(candidate.model.name).toLowerCase();
  const name = cleanText(model.display_name || model.name).toLowerCase();
  let score = 0;

  if (stats) {
    const slash = stats.indexOf("/");
    const providerHint = slash > 0 ? stats.slice(0, slash) : "";
    const modelHint = slash > 0 ? stats.slice(slash + 1) : stats;
    if (providerHint && candidate.providerID.toLowerCase() === providerHint)
      score += 100;
    if (candidateID === modelHint) score += 80;
    else if (candidateID === stats) score += 60;
    else if (candidateID.endsWith(`/${modelHint}`)) score += 50;
  }

  if (id) {
    if (candidateID === id) score += 50;
    else if (candidateID.endsWith(`/${id}`)) score += 40;
    else if (normalizeModelKey(candidateID) === normalizeModelKey(id))
      score += 20;
  }

  if (name && candidateName === name) score += 30;
  else if (name && normalizeModelKey(candidateName) === normalizeModelKey(name))
    score += 15;
  if (model.release_date && candidate.model.release_date === model.release_date)
    score += 10;
  if (model.family && candidate.model.family === model.family) score += 5;
  return score;
}

export function modelCapability(
  model: CatalogModel,
  candidates: RegistryCandidate[],
): ModelsDevModel | undefined {
  let best: ModelsDevModel | undefined;
  let bestScore = 0;
  let bestProvider = "";
  let bestID = "";
  for (const candidate of candidates) {
    const score = capabilityScore(model, candidate);
    if (score < 30) continue;
    const provider = candidate.providerID.toLowerCase();
    const id = candidate.modelID.toLowerCase();
    if (
      score > bestScore ||
      (score === bestScore &&
        (provider < bestProvider || (provider === bestProvider && id < bestID)))
    ) {
      best = candidate.model;
      bestScore = score;
      bestProvider = provider;
      bestID = id;
    }
  }
  return best;
}

function budgetVariants(
  option: Extract<ReasoningOption, { type: "budget_tokens" }>,
  outputLimit: number,
  variants: VariantMap,
): void {
  const ceiling = Math.max(
    1,
    Math.min(
      positiveNumber(option.max) ?? outputLimit - 1024,
      outputLimit - 1024,
      MAX_OUTPUT_TOKENS - 1024,
    ),
  );
  const floor = Math.min(positiveNumber(option.min) ?? 0, ceiling);
  const high = Math.min(
    Math.max(floor, Math.floor((ceiling + 1) / 2)),
    ceiling,
  );
  for (const [level, budget] of [
    ["high", high],
    ["max", ceiling],
  ] as const) {
    variants[level] = {
      reasoningEffort: level,
      thinking_budget: budget,
      thinking: { type: "enabled", budget_tokens: budget },
    };
  }
}

export function modelVariants(
  options: ReasoningOption[] | undefined,
  outputLimit: number,
): VariantMap {
  const variants: VariantMap = {};
  if (!options || options.length === 0) return variants;
  const effort = options.find(
    (option): option is Extract<ReasoningOption, { type: "effort" }> =>
      option.type === "effort",
  );
  if (effort) {
    for (const value of effort.values) {
      variants[value] = { reasoningEffort: value };
    }
    return variants;
  }
  if (options.some((option) => option.type === "toggle")) {
    variants.none = { reasoningEffort: "none" };
    variants.high = { reasoningEffort: "high" };
  }
  const budget = options.find(
    (option): option is Extract<ReasoningOption, { type: "budget_tokens" }> =>
      option.type === "budget_tokens",
  );
  if (budget) budgetVariants(budget, outputLimit, variants);
  return variants;
}

export function buildModels(
  models: CatalogModel[],
  candidates: RegistryCandidate[] = [],
): ModelMap {
  const result: ModelMap = {};
  for (const model of models) {
    if (!model.id) continue;
    const capability = modelCapability(model, candidates);
    const reasoning = model.reasoning ?? capability?.reasoning ?? true;
    const reasoningOptions =
      model.reasoning_options ?? capability?.reasoning_options;
    const limitContext =
      positiveNumber(
        model.context_window,
        model.contextWindow,
        model.limit?.context,
        capability?.limit?.context,
      ) ?? CONTEXT_WINDOW;
    const limitOutput =
      positiveNumber(
        model.max_tokens,
        model.maxTokens,
        model.max_output_tokens,
        model.limit?.output,
        capability?.limit?.output,
      ) ?? MAX_OUTPUT_TOKENS;
    result[model.id] = {
      id: model.id,
      name: displayName(model),
      family:
        model.family ??
        capability?.family ??
        (model.section === "defense" ? "defense" : ""),
      release_date: model.release_date ?? capability?.release_date,
      reasoning,
      reasoning_options: reasoningOptions,
      variants: reasoning ? modelVariants(reasoningOptions, limitOutput) : {},
      temperature: model.temperature ?? capability?.temperature ?? true,
      tool_call: model.tool_call ?? capability?.tool_call ?? true,
      attachment: model.attachment ?? capability?.attachment ?? false,
      interleaved: model.interleaved ?? capability?.interleaved,
      cost: modelCost(model, capability),
      limit: { context: limitContext, output: limitOutput },
      modalities: {
        input: model.modalities?.input ??
          capability?.modalities?.input ?? ["text"],
        output: model.modalities?.output ??
          capability?.modalities?.output ?? ["text"],
      },
      status: model.unavailable ? "deprecated" : "active",
    };
  }
  return result;
}


