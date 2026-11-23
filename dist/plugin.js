/** OpenCode V2 plugin entry point for free-pi. */
import { Plugin } from "@opencode/plugin";
import { FREE_PI_SKILL, FREE_PI_SKILL_DESCRIPTION, FREE_PI_SKILL_ID, FREE_PI_SKILL_NAME, freePiSkillPath, installFreePiAgents, installFreePiSkill, openCodeConfigDir, } from "./agents/definitions.js";
import { fetchQuota } from "./api/quota.js";
import { closeFreePiSession } from "./api/session.js";
import { readCredentialsToken } from "./auth/credentials.js";
import { tokenFromCredential } from "./auth/credential.js";
import { fetchCatalog } from "./catalog/catalog.js";
import { currentLiveLimits, loadLiveLimits, shouldVerifyWindow, verifyGatewayWindow, } from "./catalog/live.js";
import { accountAccess, buildModels, filterAccessibleModels, isReasoningEffort, modelRegistryCandidates, partitionModels, } from "./catalog/models.js";
import { fetchModelsRegistry } from "./catalog/registry.js";
import { applyProvider } from "./catalog/v2.js";
import { DEFENSE_PROVIDER_ID, PROVIDER_ID, } from "./constants.js";
import { registerIntegration } from "./integration/setup.js";
import { createLogger } from "./logging.js";
import { subscribeEvents } from "./session/events.js";
import { registerSessionHooks } from "./session/hooks.js";
import { cancelAllFinalizeTimers } from "./session/track.js";
import { createRuntimeState } from "./state.js";
import { registerGenerateImageTool } from "./tools/image-generate.js";
import { registerUsageTool } from "./tools/usage.js";
import { registerVisionTool } from "./tools/vision.js";
import { registerWebTools } from "./tools/web.js";
import { settle } from "./utils/async.js";
function activeCredentialResolver(ctx) {
    return async () => {
        try {
            const connection = await ctx.integration.connection.active(PROVIDER_ID);
            if (!connection)
                return undefined;
            return await ctx.integration.connection.resolve(connection);
        }
        catch {
            return undefined;
        }
    };
}
async function setup(ctx) {
    const log = createLogger("free-pi");
    const state = createRuntimeState();
    const includeDefense = ctx.options?.includeDefense !== false;
    const deps = {
        state,
        log,
        activeCredential: activeCredentialResolver(ctx),
        readContext: async (sessionID) => {
            try {
                return await ctx.session.context({ sessionID });
            }
            catch {
                return [];
            }
        },
        storage: ctx.storage,
    };
    // OpenCode owns agents and skills. The plugin only installs the CLI's
    // subagent personalities as native Markdown agents and registers one skill,
    // so the picker, the subagent tool, permissions and reloads stay native.
    const nativeRegistrations = [];
    try {
        const agents = await installFreePiAgents();
        if (agents.changed) {
            await ctx.agent.reload();
            log.info(`Installed ${agents.installed.length} native free-pi subagent(s)`, agents.installed);
        }
        if (agents.skipped.length > 0) {
            log.warn("Left user-owned free-pi agent files untouched", agents.skipped);
        }
    }
    catch (error) {
        log.warn("Could not install the free-pi subagents", error);
    }
    // OpenCode's own skill loader reads `skills/free-pi/SKILL.md`. Install the
    // file first so the skill has a real path, supporting files and permissions
    // like any other native skill; the transform below only fills the gap when
    // the config directory is not writable.
    try {
        const skill = await installFreePiSkill();
        if (skill.changed) {
            await ctx.skill.reload();
            log.info("Installed the native free-pi skill");
        }
        if (skill.skipped) {
            log.warn("Left the user-owned free-pi skill file untouched", freePiSkillPath(openCodeConfigDir()));
        }
    }
    catch (error) {
        log.warn("Could not install the free-pi skill file", error);
    }
    try {
        nativeRegistrations.push(await ctx.skill.transform((editor) => {
            if (editor.get(FREE_PI_SKILL_ID))
                return;
            editor.add({
                id: FREE_PI_SKILL_ID,
                name: FREE_PI_SKILL_NAME,
                description: FREE_PI_SKILL_DESCRIPTION,
                path: freePiSkillPath(openCodeConfigDir()),
                content: FREE_PI_SKILL,
            });
        }));
    }
    catch (error) {
        log.warn("Could not register the free-pi skill", error);
    }
    const [catalogResult, registryResult, quotaResult] = await Promise.all([
        settle(fetchCatalog(deps), undefined),
        settle(fetchModelsRegistry(deps), undefined),
        settle(fetchQuota(deps), undefined),
    ]);
    // The fetch may finish just after `settle` gives up; reuse whatever landed.
    const catalog = catalogResult ?? state.cachedCatalog;
    const registry = registryResult ?? state.cachedRegistry;
    const quota = quotaResult ?? state.quotaCache;
    // The picker must only offer models this account can actually use: premium
    // models need premium credits, and paid models need allowance or wallet.
    // Without a quota snapshot every model stays visible.
    const access = accountAccess(quota?.me);
    const { main: catalogMain, defense: catalogDefense } = partitionModels(catalog);
    const main = filterAccessibleModels(catalogMain, access);
    const defense = filterAccessibleModels(catalogDefense, access);
    const candidates = modelRegistryCandidates(registry);
    const live = await loadLiveLimits();
    const configuredEffort = ctx.options?.reasoningEffort;
    const buildOptions = {
        live,
        ...(configuredEffort === false
            ? { reasoningEffort: false }
            : isReasoningEffort(configuredEffort)
                ? { reasoningEffort: configuredEffort }
                : {}),
    };
    const mainModels = buildModels(main, candidates, buildOptions);
    const defenseModels = buildModels(defense, candidates, buildOptions);
    for (const [id, model] of Object.entries(mainModels)) {
        state.outputLimits.set(`${PROVIDER_ID}/${id}`, model.limit.output);
        if (model.modalities.input.includes("image")) {
            state.imageModels.add(`${PROVIDER_ID}/${id}`);
        }
    }
    for (const [id, model] of Object.entries(defenseModels)) {
        state.outputLimits.set(`${DEFENSE_PROVIDER_ID}/${id}`, model.limit.output);
        if (model.modalities.input.includes("image")) {
            state.imageModels.add(`${DEFENSE_PROVIDER_ID}/${id}`);
        }
    }
    const credential = await deps.activeCredential().catch(() => undefined);
    state.providerToken =
        tokenFromCredential(credential) ?? (await readCredentialsToken());
    await registerIntegration(ctx, deps);
    await ctx.provider.transform((editor) => {
        // Rebuilt on every transform so a learned context ceiling applies as soon
        // as the response hook records it, without restarting OpenCode.
        const active = currentLiveLimits() ?? live;
        const buildOptionsNow = { ...buildOptions, live: active };
        const mainNow = buildModels(main, candidates, buildOptionsNow);
        const defenseNow = buildModels(defense, candidates, buildOptionsNow);
        applyProvider(editor, PROVIDER_ID, "Free Pi", mainNow, state.providerToken);
        if (includeDefense && defense.length > 0) {
            applyProvider(editor, DEFENSE_PROVIDER_ID, "Free Pi Defense", defenseNow, state.providerToken);
        }
    });
    // The gateway does not publish its context ceiling. Verify the compiled
    // window against it once a week with a free model, in the background, and
    // persist the result for the next catalog build. Prefer the free model with
    // the largest prompt already accepted in real traffic: it has the most
    // evidence behind it, so the growth probes describe the window sessions use.
    if (ctx.options?.liveLimits !== false && shouldVerifyWindow(live)) {
        const free = main.filter((model) => model.free === true && typeof model.id === "string");
        const probe = free
            .map((model) => ({
            id: model.id,
            seen: live?.models[model.id ?? ""]?.maxPromptTokens ?? 0,
        }))
            .sort((a, b) => b.seen - a.seen)[0]?.id ??
            (catalog?.default_model &&
                free.some((model) => model.id === catalog.default_model)
                ? catalog.default_model
                : undefined) ??
            free[0]?.id ??
            Object.keys(mainModels)[0];
        if (probe) {
            void verifyGatewayWindow(deps, { model: probe }).catch(() => undefined);
        }
    }
    // V1 selected the catalog default when the user had no model configured.
    await ctx.model.transform((editor) => {
        if (editor.default.get())
            return;
        const preferred = (catalog?.default_model && mainModels[catalog.default_model]
            ? catalog.default_model
            : undefined) ?? Object.keys(mainModels)[0];
        if (preferred)
            editor.default.set(PROVIDER_ID, preferred);
    });
    const registrations = await registerSessionHooks(ctx, deps);
    registrations.push(...nativeRegistrations);
    const tools = [
        { name: "look_at_image", register: () => registerVisionTool(ctx, deps) },
        { name: "free_pi_usage", register: () => registerUsageTool(ctx, deps) },
        { name: "web", register: () => registerWebTools(ctx, deps) },
        { name: "generate_image", register: () => registerGenerateImageTool(ctx, deps) },
    ];
    for (const tool of tools) {
        try {
            registrations.push(await tool.register());
        }
        catch (error) {
            log.warn(`Could not register the ${tool.name} tools`, error);
        }
    }
    const abort = new AbortController();
    const eventTask = subscribeEvents(ctx, deps, abort.signal);
    log.info(`Loaded ${main.length} free-pi model(s) and ${includeDefense ? defense.length : 0} defense model(s)`, {
        defaultModel: catalog?.default_model,
        clientVersion: state.latestClientVersion,
        capabilities: candidates.length,
        models: main.map((model) => model.id),
    });
    return async () => {
        abort.abort();
        cancelAllFinalizeTimers(deps);
        await eventTask.catch(() => undefined);
        for (const registration of registrations.reverse()) {
            await registration.dispose().catch(() => undefined);
        }
        await closeFreePiSession(deps).catch(() => undefined);
    };
}
export const FreePiPlugin = Plugin.define({
    id: PROVIDER_ID,
    setup,
});
export default FreePiPlugin;
