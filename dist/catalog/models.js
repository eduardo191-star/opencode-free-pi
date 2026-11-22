/** Turns the free-pi catalog and models.dev registry into model definitions. */
import { COMPACT100_CONTEXT_WINDOW, CONTEXT_WINDOW, DEFAULT_REASONING_EFFORT, DEFAULT_THINKING_LEVELS, MAX_OUTPUT_TOKENS, REASONING_EFFORTS, } from "../constants.js";
import { positiveNumber } from "../utils/numbers.js";
import { cleanText } from "../utils/text.js";
export function usableModels(catalog) {
    return (catalog?.models ?? []).filter((model) => typeof model.id === "string" && model.id.length > 0);
}
export function partitionModels(catalog) {
    const models = usableModels(catalog);
    const main = models.filter((model) => model.section !== "defense");
    const defense = models.filter((model) => model.section === "defense");
    if (main.length > 0)
        return { main, defense };
    if (typeof catalog?.default_model === "string" &&
        catalog.default_model.length > 0) {
        return { main: [{ id: catalog.default_model }], defense };
    }
    return { main: [], defense };
}
export function displayName(model) {
    const base = model.display_name || model.name || model.id || "model";
    const tags = [];
    const lower = base.toLowerCase();
    if (model.free === true && !lower.includes("free"))
        tags.push("free");
    if (model.tier === "premium" &&
        !lower.includes("premium") &&
        !(model.note ?? "").toLowerCase().includes("premium")) {
        tags.push("premium");
    }
    if (model.note && !lower.includes(model.note.toLowerCase()))
        tags.push(model.note);
    if (model.usage_x && !lower.includes(`${model.usage_x}x`)) {
        tags.push(`~${model.usage_x}x usage`);
    }
    return tags.length > 0 ? `${base} (${tags.join(" · ")})` : base;
}
export function modelCost(_model, _capability) {
    // free-pi bills in credits against a daily allowance; it does not charge
    // per-token USD. The provider CLI registers every model with zero cost and
    // shows the real usage through /usage, so publishing reseller prices here
    // would only invent a cost the account never pays.
    return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
}
export function modelRegistryCandidates(registry) {
    const candidates = [];
    for (const [providerID, provider] of Object.entries(registry ?? {})) {
        for (const [modelID, model] of Object.entries(provider?.models ?? {})) {
            if (model && typeof model === "object")
                candidates.push({ providerID, modelID, model });
        }
    }
    return candidates;
}
function normalizeModelKey(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function capabilityScore(model, candidate) {
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
        if (candidateID === modelHint)
            score += 80;
        else if (candidateID === stats)
            score += 60;
        else if (candidateID.endsWith(`/${modelHint}`))
            score += 50;
    }
    if (id) {
        if (candidateID === id)
            score += 50;
        else if (candidateID.endsWith(`/${id}`))
            score += 40;
        else if (normalizeModelKey(candidateID) === normalizeModelKey(id))
            score += 20;
    }
    if (name && candidateName === name)
        score += 30;
    else if (name && normalizeModelKey(candidateName) === normalizeModelKey(name))
        score += 15;
    if (model.release_date && candidate.model.release_date === model.release_date)
        score += 10;
    if (model.family && candidate.model.family === model.family)
        score += 5;
    return score;
}
export function modelCapability(model, candidates) {
    let best;
    let bestScore = 0;
    let bestProvider = "";
    let bestID = "";
    for (const candidate of candidates) {
        const score = capabilityScore(model, candidate);
        if (score < 30)
            continue;
        const provider = candidate.providerID.toLowerCase();
        const id = candidate.modelID.toLowerCase();
        if (score > bestScore ||
            (score === bestScore &&
                (provider < bestProvider || (provider === bestProvider && id < bestID)))) {
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
function budgetVariants(variants) {
    variants.high = { reasoningEffort: "high" };
    variants.max = { reasoningEffort: "max" };
}
export function modelVariants(options, _outputLimit) {
    const variants = {};
    // The provider CLI offers these levels to every reasoning model because its
    // `thinkingLevelMap` is unset; `xhigh` and `max` stay opt-in.
    if (!options || options.length === 0) {
        for (const level of DEFAULT_THINKING_LEVELS) {
            variants[level] = { reasoningEffort: level };
        }
        return variants;
    }
    const effort = options.find((option) => option.type === "effort");
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
    if (options.some((option) => option.type === "budget_tokens")) {
        budgetVariants(variants);
    }
    return variants;
}
export function isReasoningEffort(value) {
    return (typeof value === "string" &&
        REASONING_EFFORTS.includes(value));
}
/**
 * The effort sent when no variant is selected. `false` leaves the gateway's
 * own default untouched; otherwise the catalog's supported levels win over
 * `medium`, so a model that only accepts `low`/`high` never gets an effort it
 * would reject.
 */
export function preferredReasoningEffort(options, configured) {
    if (configured === false)
        return undefined;
    if (configured)
        return configured;
    if (!options || options.length === 0)
        return DEFAULT_REASONING_EFFORT;
    const effort = options.find((option) => option.type === "effort");
    if (effort) {
        if (effort.values.includes(DEFAULT_REASONING_EFFORT))
            return DEFAULT_REASONING_EFFORT;
        if (effort.values.includes("high"))
            return "high";
        return effort.values[effort.values.length - 1];
    }
    if (options.some((option) => option.type === "toggle"))
        return "high";
    if (options.some((option) => option.type === "budget_tokens"))
        return "high";
    return DEFAULT_REASONING_EFFORT;
}
export function accountAccess(me) {
    if (!me)
        return undefined;
    const credits = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
    const wallet = credits(me.bonus_wallet_credits) +
        credits(me.regular_wallet_credits) +
        credits(me.bonus_credits);
    const remaining = credits(me.remaining_credits_today);
    return {
        premiumCredits: credits(me.premium_credits) +
            credits(me.premium_bought_credits) +
            credits(me.premium_gifted_credits),
        walletCredits: wallet,
        remainingCredits: remaining,
        hasAllowance: remaining > 0 || credits(me.remaining_usd_today) > 0,
    };
}
function isPremiumModel(model) {
    if (model.tier === "premium")
        return true;
    return /premium\s+credits/i.test(model.note ?? "");
}
export function filterAccessibleModels(models, access) {
    // Without a quota snapshot, show everything instead of guessing and hiding
    // models the account may be able to use.
    if (!access)
        return models.filter((model) => model.unavailable !== true);
    return models.filter((model) => {
        if (model.unavailable === true)
            return false;
        if (isPremiumModel(model))
            return access.premiumCredits > 0;
        if (model.free === true)
            return true;
        return access.hasAllowance || access.walletCredits > 0;
    });
}
export function buildModels(models, candidates = [], options = {}) {
    const result = {};
    for (const model of models) {
        if (!model.id)
            continue;
        const capability = modelCapability(model, candidates);
        const reasoning = model.reasoning ?? capability?.reasoning ?? true;
        const reasoningOptions = model.reasoning_options ?? capability?.reasoning_options;
        // free-pi enforces a 200k input window and 32k output cap on every model,
        // regardless of what models.dev reports for the upstream provider. The
        // provider CLI registers exactly these limits, so clamp to them here too:
        // an advertised 1M window would let OpenCode grow a session past the
        // server's real ceiling and fail with `context_too_long` instead of
        // compacting.
        const contextCeiling = options.compact100
            ? COMPACT100_CONTEXT_WINDOW
            : CONTEXT_WINDOW;
        const limitContext = Math.min(positiveNumber(model.context_window, model.contextWindow, model.limit?.context, capability?.limit?.context) ?? contextCeiling, contextCeiling);
        const limitOutput = Math.min(positiveNumber(model.max_tokens, model.maxTokens, model.max_output_tokens, model.limit?.output, capability?.limit?.output) ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
        const defaultEffort = reasoning
            ? preferredReasoningEffort(reasoningOptions, options.reasoningEffort)
            : undefined;
        result[model.id] = {
            id: model.id,
            name: displayName(model),
            family: model.family ??
                capability?.family ??
                (model.section === "defense" ? "defense" : ""),
            release_date: model.release_date ?? capability?.release_date,
            reasoning,
            reasoning_options: reasoningOptions,
            variants: reasoning ? modelVariants(reasoningOptions, limitOutput) : {},
            ...(defaultEffort ? { settings: { reasoningEffort: defaultEffort } } : {}),
            enabled: model.unavailable !== true,
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
