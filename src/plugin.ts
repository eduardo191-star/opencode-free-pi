/** OpenCode V2 plugin entry point for free-pi. */

import { Plugin } from "@opencode/plugin";
import {
  FREE_PI_SKILL,
  FREE_PI_SKILL_DESCRIPTION,
  FREE_PI_SKILL_ID,
  FREE_PI_SKILL_NAME,
  freePiSkillPath,
  installFreePiAgents,
  installFreePiSkill,
  openCodeConfigDir,
} from "./agents/definitions.js";
import { fetchQuota } from "./api/quota.js";
import { closeFreePiSession } from "./api/session.js";
import { readCredentialsToken } from "./auth/credentials.js";
import { tokenFromCredential } from "./auth/credential.js";
import { fetchCatalog } from "./catalog/catalog.js";
import {
  currentLiveLimits,
  loadLiveLimits,
  shouldVerifyWindow,
  verifyGatewayWindow,
} from "./catalog/live.js";
import {
  accountAccess,
  buildModels,
  filterAccessibleModels,
  isReasoningEffort,
  modelRegistryCandidates,
  partitionModels,
} from "./catalog/models.js";
import { fetchModelsRegistry } from "./catalog/registry.js";
import { applyProvider } from "./catalog/v2.js";
import {
  CATALOG_RECOVERY_DELAYS_MS,
  CATALOG_RECOVERY_INTERVAL_MS,
  CATALOG_RECOVERY_LOG_EVERY,
  DEFENSE_PROVIDER_ID,
  PROVIDER_ID,
} from "./constants.js";
import type { Deps } from "./deps.js";
import { registerIntegration } from "./integration/setup.js";
import { createLogger } from "./logging.js";
import { applyEnvironmentProxy } from "./network/proxy.js";
import { subscribeEvents } from "./session/events.js";
import { registerSessionHooks } from "./session/hooks.js";
import { cancelAllFinalizeTimers } from "./session/track.js";
import { createRuntimeState } from "./state.js";
import { registerGenerateImageTool } from "./tools/image-generate.js";
import { registerUsageTool } from "./tools/usage.js";
import { registerSubagentTool } from "./tools/subagent.js";
import { registerVisionTool } from "./tools/vision.js";
import { registerWebTools } from "./tools/web.js";
import { settle } from "./utils/async.js";

function activeCredentialResolver(ctx: Plugin.Context) {
  return async () => {
    try {
      const connection = await ctx.integration.connection.active(PROVIDER_ID);
      if (!connection) return undefined;
      return await ctx.integration.connection.resolve(connection);
    } catch {
      return undefined;
    }
  };
}

async function setup(ctx: Plugin.Context): Promise<() => Promise<void>> {
  const log = createLogger("free-pi");
  // A VPN or corporate setup may only allow traffic through a local proxy.
  // Enable it before the first catalog request so the provider registers models
  // instead of disappearing from the picker.
  applyEnvironmentProxy(log);
  const state = createRuntimeState();
  const includeDefense = ctx.options?.includeDefense !== false;

  const deps: Deps = {
    state,
    log,
    activeCredential: activeCredentialResolver(ctx),
    readContext: async (sessionID) => {
      try {
        return await ctx.session.context({ sessionID });
      } catch {
        return [];
      }
    },
    readSession: async (sessionID) => {
      try {
        const info = await ctx.session.get({ sessionID });
        return {
          id: info.id,
          parentID: info.parentID,
          title: info.title,
          agent: info.agent,
          outcome: info.outcome,
          updated: info.time?.updated,
        };
      } catch {
        return undefined;
      }
    },
    listSubagentSessions: async (parentID) => {
      try {
        const result = await ctx.session.list({ parentID, limit: 50 });
        return (result.data ?? []).map((info) => ({
          id: info.id,
          parentID: info.parentID,
          title: info.title,
          agent: info.agent,
          outcome: info.outcome,
          updated: info.time?.updated,
        }));
      } catch {
        return [];
      }
    },
    storage: ctx.storage,
  };

  // OpenCode owns agents and skills. The plugin only installs the CLI's
  // subagent personalities as native Markdown agents and registers one skill,
  // so the picker, the subagent tool, permissions and reloads stay native.
  const nativeRegistrations: Array<{ dispose: () => Promise<void> }> = [];
  try {
    const agents = await installFreePiAgents();
    if (agents.changed) {
      await ctx.agent.reload();
      log.info(
        `Installed ${agents.installed.length} native free-pi subagent(s)`,
        agents.installed,
      );
    }
    if (agents.skipped.length > 0) {
      log.warn(
        "Left user-owned free-pi agent files untouched",
        agents.skipped,
      );
    }
  } catch (error) {
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
      log.warn(
        "Left the user-owned free-pi skill file untouched",
        freePiSkillPath(openCodeConfigDir()),
      );
    }
  } catch (error) {
    log.warn("Could not install the free-pi skill file", error);
  }
  try {
    nativeRegistrations.push(
      await ctx.skill.transform((editor) => {
        if (editor.get(FREE_PI_SKILL_ID)) return;
        editor.add({
          id: FREE_PI_SKILL_ID,
          name: FREE_PI_SKILL_NAME,
          description: FREE_PI_SKILL_DESCRIPTION,
          path: freePiSkillPath(openCodeConfigDir()),
          content: FREE_PI_SKILL,
        } as any);
      }),
    );
  } catch (error) {
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
  const { main: catalogMain, defense: catalogDefense } =
    partitionModels(catalog);
  let currentCatalog = catalog;
  let currentMain = filterAccessibleModels(catalogMain, access);
  let currentDefense = filterAccessibleModels(catalogDefense, access);
  const candidates = modelRegistryCandidates(registry);
  const live = await loadLiveLimits();
  const configuredEffort = ctx.options?.reasoningEffort;
  const buildOptions = {
    live,
    ...(configuredEffort === false
      ? { reasoningEffort: false as const }
      : isReasoningEffort(configuredEffort)
        ? { reasoningEffort: configuredEffort }
        : {}),
  };

  // Rebuilt on every call so a learned context ceiling or a recovered catalog
  // applies without restarting OpenCode.
  const buildMain = () =>
    buildModels(currentMain, candidates, {
      ...buildOptions,
      live: currentLiveLimits() ?? live,
    });
  const buildDefense = () =>
    buildModels(currentDefense, candidates, {
      ...buildOptions,
      live: currentLiveLimits() ?? live,
    });

  function indexModelState(): void {
    const mainNow = buildMain();
    const defenseNow = buildDefense();
    for (const [id, model] of Object.entries(mainNow)) {
      state.outputLimits.set(`${PROVIDER_ID}/${id}`, model.limit.output);
      state.contextLimits.set(`${PROVIDER_ID}/${id}`, model.limit.context);
      if (model.modalities.input.includes("image")) {
        state.imageModels.add(`${PROVIDER_ID}/${id}`);
      }
    }
    for (const [id, model] of Object.entries(defenseNow)) {
      state.outputLimits.set(`${DEFENSE_PROVIDER_ID}/${id}`, model.limit.output);
      state.contextLimits.set(`${DEFENSE_PROVIDER_ID}/${id}`, model.limit.context);
      if (model.modalities.input.includes("image")) {
        state.imageModels.add(`${DEFENSE_PROVIDER_ID}/${id}`);
      }
    }
  }
  indexModelState();

  const credential = await deps.activeCredential().catch(() => undefined);
  state.providerToken =
    tokenFromCredential(credential) ?? (await readCredentialsToken());

  await registerIntegration(ctx, deps);

  await ctx.provider.transform((editor) => {
    applyProvider(
      editor,
      PROVIDER_ID,
      "Free Pi",
      buildMain(),
      state.providerToken,
    );
    if (includeDefense && currentDefense.length > 0) {
      applyProvider(
        editor,
        DEFENSE_PROVIDER_ID,
        "Free Pi Defense",
        buildDefense(),
        state.providerToken,
      );
    }
  });

  // The gateway does not publish its context ceiling. Verify the compiled
  // window against it once a week with a free model, in the background, and
  // persist the result for the next catalog build. Prefer the free model with
  // the largest prompt already accepted in real traffic: it has the most
  // evidence behind it, so the growth probes describe the window sessions use.
  if (ctx.options?.liveLimits !== false && shouldVerifyWindow(live)) {
    const free = currentMain.filter(
      (model) => model.free === true && typeof model.id === "string",
    );
    const probe =
      free
        .map((model) => ({
          id: model.id,
          seen: live?.models[model.id ?? ""]?.maxPromptTokens ?? 0,
        }))
        .sort((a, b) => b.seen - a.seen)[0]?.id ??
      (currentCatalog?.default_model &&
      free.some((model) => model.id === currentCatalog?.default_model)
        ? currentCatalog.default_model
        : undefined) ??
      free[0]?.id ??
      Object.keys(buildMain())[0];
    if (probe) {
      void verifyGatewayWindow(deps, { model: probe }).catch(() => undefined);
    }
  }

  // V1 selected the catalog default when the user had no model configured.
  await ctx.model.transform((editor) => {
    if (editor.default.get()) return;
    const models = buildMain();
    const preferred =
      (currentCatalog?.default_model && models[currentCatalog.default_model]
        ? currentCatalog.default_model
        : undefined) ?? Object.keys(models)[0];
    if (preferred) editor.default.set(PROVIDER_ID, preferred);
  });

  const registrations = await registerSessionHooks(ctx, deps);
  registrations.push(...nativeRegistrations);
  const tools: Array<{
    name: string;
    register: () => Promise<{ dispose: () => Promise<void> }>;
  }> = [
    { name: "look_at_image", register: () => registerVisionTool(ctx, deps) },
    { name: "free_pi_usage", register: () => registerUsageTool(ctx, deps) },
    {
      name: "free_pi_subagent_read",
      register: () => registerSubagentTool(ctx, deps),
    },
    { name: "web", register: () => registerWebTools(ctx, deps) },
    { name: "generate_image", register: () => registerGenerateImageTool(ctx, deps) },
  ];
  for (const tool of tools) {
    try {
      registrations.push(await tool.register());
    } catch (error) {
      log.warn(`Could not register the ${tool.name} tools`, error);
    }
  }
  const abort = new AbortController();
  const eventTask = subscribeEvents(ctx, deps, abort.signal);

  // A failed catalog fetch registers the provider with zero models, which
  // hides every free-pi entry from the model picker for this location until
  // OpenCode restarts. Retry in the background and re-register the models as
  // soon as the gateway answers, so a transient timeout heals on its own.
  const waitForAbort = (ms: number) =>
    new Promise<void>((resolve) => {
      if (abort.signal.aborted) return resolve();
      const finish = () => {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      abort.signal.addEventListener("abort", finish, { once: true });
    });
  const catalogRecovery = (async () => {
    // Keep going while the provider has no models: a failed cold start must heal
    // even if the outage outlasts the initial burst. An empty list because the
    // account filter removed everything is also temporary (quota refreshes).
    let attempt = 0;
    while (!abort.signal.aborted && currentMain.length === 0) {
      const delay =
        CATALOG_RECOVERY_DELAYS_MS[attempt] ?? CATALOG_RECOVERY_INTERVAL_MS;
      attempt += 1;
      await waitForAbort(delay);
      if (abort.signal.aborted || currentMain.length > 0) return;
      const next = await fetchCatalog(deps).catch(() => undefined);
      if (!next) {
        if (attempt % CATALOG_RECOVERY_LOG_EVERY === 0) {
          log.warn("free-pi catalog is still unreachable; models stay unavailable", {
            attempts: attempt,
          });
        }
        continue;
      }
      const parts = partitionModels(next);
      const accessNow = accountAccess(state.quotaCache?.me);
      const nextMain = filterAccessibleModels(parts.main, accessNow);
      if (nextMain.length === 0) continue;
      currentCatalog = next;
      currentMain = nextMain;
      currentDefense = filterAccessibleModels(parts.defense, accessNow);
      indexModelState();
      await ctx.provider.reload().catch(() => undefined);
      await ctx.model.reload().catch(() => undefined);
      log.info(
        `free-pi catalog recovered; registered ${currentMain.length} model(s)`,
        {
          defaultModel: currentCatalog?.default_model,
          clientVersion: state.latestClientVersion,
          models: currentMain.map((model) => model.id),
        },
      );
      return;
    }
  })();
  void catalogRecovery.catch(() => undefined);

  log.info(
    `Loaded ${currentMain.length} free-pi model(s) and ${includeDefense ? currentDefense.length : 0} defense model(s)`,
    {
      defaultModel: currentCatalog?.default_model,
      clientVersion: state.latestClientVersion,
      capabilities: candidates.length,
      models: currentMain.map((model) => model.id),
    },
  );

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
