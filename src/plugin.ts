/** OpenCode V2 plugin entry point for free-pi. */

import { Plugin } from "@opencode/plugin";
import { closeFreePiSession } from "./api/session.js";
import { readCredentialsToken } from "./auth/credentials.js";
import { tokenFromCredential } from "./auth/credential.js";
import { fetchCatalog } from "./catalog/catalog.js";
import {
  buildModels,
  modelRegistryCandidates,
  partitionModels,
} from "./catalog/models.js";
import { fetchModelsRegistry } from "./catalog/registry.js";
import { applyProvider } from "./catalog/v2.js";
import {
  DEFENSE_PROVIDER_ID,
  PROVIDER_ID,
} from "./constants.js";
import type { Deps } from "./deps.js";
import { registerIntegration } from "./integration/setup.js";
import { createLogger } from "./logging.js";
import { subscribeEvents } from "./session/events.js";
import { registerSessionHooks } from "./session/hooks.js";
import { cancelAllFinalizeTimers } from "./session/track.js";
import { createRuntimeState } from "./state.js";
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
  };

  const [catalog, registry] = await Promise.all([
    settle(fetchCatalog(deps), undefined),
    settle(fetchModelsRegistry(deps), undefined),
  ]);
  const { main, defense } = partitionModels(catalog);
  const candidates = modelRegistryCandidates(registry);
  const mainModels = buildModels(main, candidates);
  const defenseModels = buildModels(defense, candidates);

  for (const [id, model] of Object.entries(mainModels)) {
    state.outputLimits.set(`${PROVIDER_ID}/${id}`, model.limit.output);
  }
  for (const [id, model] of Object.entries(defenseModels)) {
    state.outputLimits.set(`${DEFENSE_PROVIDER_ID}/${id}`, model.limit.output);
  }

  const credential = await deps.activeCredential().catch(() => undefined);
  state.providerToken =
    tokenFromCredential(credential) ?? (await readCredentialsToken());

  await registerIntegration(ctx, deps);

  await ctx.provider.transform((editor) => {
    applyProvider(
      editor,
      PROVIDER_ID,
      "Free Pi",
      mainModels,
      state.providerToken,
    );
    if (includeDefense && defense.length > 0) {
      applyProvider(
        editor,
        DEFENSE_PROVIDER_ID,
        "Free Pi Defense",
        defenseModels,
        state.providerToken,
      );
    }
  });

  // V1 selected the catalog default when the user had no model configured.
  await ctx.model.transform((editor) => {
    if (editor.default.get()) return;
    const preferred =
      (catalog?.default_model && mainModels[catalog.default_model]
        ? catalog.default_model
        : undefined) ?? Object.keys(mainModels)[0];
    if (preferred) editor.default.set(PROVIDER_ID, preferred);
  });

  const registrations = await registerSessionHooks(ctx, deps);
  const abort = new AbortController();
  const eventTask = subscribeEvents(ctx, deps, abort.signal);

  log.info(
    `Loaded ${main.length} free-pi model(s) and ${includeDefense ? defense.length : 0} defense model(s)`,
    {
      defaultModel: catalog?.default_model,
      clientVersion: state.latestClientVersion,
      capabilities: candidates.length,
      costArm: state.costExperimentArm,
      models: main.map((model) => model.id),
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
