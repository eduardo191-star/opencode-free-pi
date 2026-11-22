/** Turns the free-pi catalog and models.dev registry into model definitions. */

import {
  CONTEXT_WINDOW,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_THINKING_LEVELS,
  MAX_CONTEXT_WINDOW,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_CEILING,
  REASONING_EFFORTS,
} from "../constants.js";
import type {
  Catalog,
  CatalogModel,
  MeResponse,
  ModelDefinition,
  ModelRegistry,
  ModelsDevModel,
  ReasoningOption,
  RegistryCandidate,
} from "../types.js";
import type { LiveLimits } from "./live.js";
import { positiveNumber } from "../utils/numbers.js";
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
  _model: CatalogModel,
  _capability?: ModelsDevModel,
): ModelDefinition["cost"] {
  // free-pi bills in credits against a daily allowance; it does not charge
  // per-token USD. The provider CLI registers every model with zero cost and
  // shows the real usage through /usage, so publishing reseller prices here
  // would only invent a cost the account never pays.
  return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
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

/**
 * free-pi's openai-compatible route only understands `reasoning_effort`.
 * pi's `thinking_budget` and `thinking` fields are dropped by OpenCode's
 * lowering, so advertising them would be inert. Budget-style catalogs still
 * expose their top levels as effort variants.
 */
function budgetVariants(variants: VariantMap): void {
  variants.high = { reasoningEffort: "high" };
  variants.max = { reasoningEffort: "max" };
}

export function modelVariants(
  options: ReasoningOption[] | undefined,
  _outputLimit: number,
): VariantMap {
  // The provider CLI registers every model with `reasoning: true` and an unset
  // `thinkingLevelMap`, so it offers these levels to every model. models.dev
  // lists fewer levels for some upstream models, but the gateway accepts the
  // CLI's set (including `max`), and hiding levels only makes the picker
  // disagree with the CLI.
  const variants: VariantMap = {};
  for (const level of DEFAULT_THINKING_LEVELS) {
    variants[level] = { reasoningEffort: level };
  }
  if (!options || options.length === 0) return variants;
  const effort = options.find(
    (option): option is Extract<ReasoningOption, { type: "effort" }> =>
      option.type === "effort",
  );
  if (effort) {
    for (const value of effort.values) {
      variants[value] = { reasoningEffort: value };
    }
  }
  if (options.some((option) => option.type === "budget_tokens")) {
    budgetVariants(variants);
  }
  return variants;
}

/**
 * The levels the model actually exposes, so OpenCode's picker and the
 * `reasoning_effort` values the plugin sends come from the same list. The
 * gateway accepts every level for every model, so the CLI set always applies.
 */
export function effectiveReasoningOptions(
  options: ReasoningOption[] | undefined,
  variants: VariantMap,
): ReasoningOption[] {
  const values = Object.keys(variants);
  const declared = options?.find(
    (option): option is Extract<ReasoningOption, { type: "effort" }> =>
      option.type === "effort",
  )?.values;
  for (const value of declared ?? []) {
    if (!values.includes(value)) values.push(value);
  }
  return values.length > 0 ? [{ type: "effort", values }] : [];
}

export function isReasoningEffort(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

/**
 * The effort sent when no variant is selected. `false` leaves the gateway's
 * own default untouched; otherwise the catalog's supported levels win over
 * `medium`, so a model that only accepts `low`/`high` never gets an effort it
 * would reject.
 */
export function preferredReasoningEffort(
  options: ReasoningOption[] | undefined,
  configured?: string | false,
): string | undefined {
  if (configured === false) return undefined;
  if (configured) return configured;
  // The provider CLI's levels are the source of truth: models.dev often lists
  // only a subset, but the gateway accepts the CLI set. `medium` is the sane
  // middle ground between the CLI's off default and burning tokens on `high`.
  if (options?.some((option) => option.type === "budget_tokens")) return "high";
  return DEFAULT_REASONING_EFFORT;
}

export type BuildModelsOptions = {
  /**
   * Effort sent when the user has not picked a variant. `false` keeps the
   * gateway default. Defaults to `medium` because an unset effort makes the
   * free models answer before they reason.
   */
  reasoningEffort?: string | false;
  /**
   * Limits and capabilities observed from the live gateway. The verified
   * window replaces the compiled one, and per-model observations prove what the
   * server really accepted for this account.
   */
  live?: LiveLimits;
};

/**
 * What the signed-in account can actually use, derived from `GET /me`.
 *
 * free-pi lets the free allowance pay for every non-premium model while the
 * daily credits last, so those stay available even when the wallet is empty.
 * Premium-only models need premium credits, and showing them to an account
 * without any only produces `model_requires_credits` failures from `/model`.
 */
export type AccountAccess = {
  readonly premiumCredits: number;
  readonly walletCredits: number;
  readonly remainingCredits: number;
  readonly hasAllowance: boolean;
};

export function accountAccess(me: MeResponse | undefined): AccountAccess | undefined {
  if (!me) return undefined;
  const credits = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const wallet =
    credits(me.bonus_wallet_credits) +
    credits(me.regular_wallet_credits) +
    credits(me.bonus_credits);
  const remaining = credits(me.remaining_credits_today);
  return {
    premiumCredits:
      credits(me.premium_credits) +
      credits(me.premium_bought_credits) +
      credits(me.premium_gifted_credits),
    walletCredits: wallet,
    remainingCredits: remaining,
    hasAllowance: remaining > 0 || credits(me.remaining_usd_today) > 0,
  };
}

function isPremiumModel(model: CatalogModel): boolean {
  if (model.tier === "premium") return true;
  return /premium\s+credits/i.test(model.note ?? "");
}

export function filterAccessibleModels(
  models: CatalogModel[],
  access: AccountAccess | undefined,
): CatalogModel[] {
  // Without a quota snapshot, show everything instead of guessing and hiding
  // models the account may be able to use.
  if (!access) return models.filter((model) => model.unavailable !== true);
  return models.filter((model) => {
    if (model.unavailable === true) return false;
    if (isPremiumModel(model)) return access.premiumCredits > 0;
    if (model.free === true) return true;
    return access.hasAllowance || access.walletCredits > 0;
  });
}

const KNOWN_INPUT_MODALITIES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "pdf",
]);

/**
 * Native modalities for the chat route. models.dev describes the upstream
 * model, and the gateway forwards image parts to multimodal upstreams, so an
 * image-capable model is advertised as such. Output is always text: free-pi has
 * no image results on the chat route, and the plugin registers every model as
 * zero-cost text output.
 */
function modelModalities(
  model: CatalogModel,
  capability: ModelsDevModel | undefined,
): { input: string[]; output: string[] } {
  const declared = model.modalities?.input ?? capability?.modalities?.input;
  const input = (declared ?? ["text"]).filter((value) =>
    KNOWN_INPUT_MODALITIES.has(value),
  );
  if (input.length === 0) input.push("text");
  if (!input.includes("text")) input.unshift("text");
  return { input, output: ["text"] };
}

export function buildModels(
  models: CatalogModel[],
  candidates: RegistryCandidate[] = [],
  options: BuildModelsOptions = {},
): ModelMap {
  const result: ModelMap = {};
  for (const model of models) {
    if (!model.id) continue;
    const capability = modelCapability(model, candidates);
    // The provider CLI registers every model as `reasoning: true`; models.dev
    // sometimes omits or disagrees for the upstream alias. Trust the catalog's
    // explicit answer, otherwise keep reasoning on like the CLI does.
    const reasoning = model.reasoning ?? true;
    const reasoningOptions =
      model.reasoning_options ?? capability?.reasoning_options;
    // free-pi enforces a context window on every model regardless of what
    // models.dev reports for the upstream provider. The provider CLI starts at
    // 200k, but the gateway does not publish its ceiling: `verifyGatewayWindow`
    // measures it (growing past 200k when the gateway accepts more) and the
    // result is used here from the next start. Real steps also prove the gateway
    // accepted at least their prompt size. A published catalog field still wins,
    // but only inside that measured ceiling, so an advertised 1M window can
    // never push a session past what the gateway takes.
    const observed = options.live?.models[model.id]?.maxPromptTokens ?? 0;
    const contextCeiling = Math.min(
      MAX_CONTEXT_WINDOW,
      Math.max(options.live?.window?.tokens ?? CONTEXT_WINDOW, observed),
    );
    const limitContext = Math.min(
      positiveNumber(
        model.context_window,
        model.contextWindow,
        model.limit?.context,
        capability?.limit?.context,
      ) ?? contextCeiling,
      contextCeiling,
    );
    // Reasoning shares the output budget. When models.dev knows the upstream
    // model emits more than the CLI's 32k, advertise that larger budget (up to a
    // sane ceiling) instead of truncating the chain of thought.
    const limitOutput = Math.min(
      positiveNumber(
        model.max_tokens,
        model.maxTokens,
        model.max_output_tokens,
        model.limit?.output,
        capability?.limit?.output,
      ) ?? MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS_CEILING,
    );
    const defaultEffort = reasoning
      ? preferredReasoningEffort(reasoningOptions, options.reasoningEffort)
      : undefined;
    const variants = reasoning
      ? modelVariants(reasoningOptions, limitOutput)
      : {};
    const modalities = modelModalities(model, capability);
    const declaredOptions = reasoning
      ? effectiveReasoningOptions(reasoningOptions, variants)
      : undefined;
    result[model.id] = {
      id: model.id,
      name: displayName(model),
      family:
        model.family ??
        capability?.family ??
        (model.section === "defense" ? "defense" : ""),
      release_date: model.release_date ?? capability?.release_date,
      reasoning,
      ...(declaredOptions && declaredOptions.length > 0
        ? { reasoning_options: declaredOptions }
        : {}),
      variants,
      ...(defaultEffort ? { settings: { reasoningEffort: defaultEffort } } : {}),
      enabled: model.unavailable !== true,
      temperature: model.temperature ?? capability?.temperature ?? true,
      tool_call: model.tool_call ?? capability?.tool_call ?? true,
      attachment:
        model.attachment ??
        capability?.attachment ??
        modalities.input.includes("image"),
      interleaved: model.interleaved ?? capability?.interleaved,
      cost: modelCost(model, capability),
      limit: { context: limitContext, output: limitOutput },
      modalities,
      status: model.unavailable ? "deprecated" : "active",
    };
  }
  return result;
}


