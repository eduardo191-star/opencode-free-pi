/** Converts internal model definitions into OpenCode V2 provider records. */

import {
  CHUNK_TIMEOUT_MS,
  CONTEXT_WINDOW,
  HEADER_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS,
  OPENAI_COMPATIBLE_PACKAGE,
  PROVIDER_ID,
} from "../constants.js";
import { completionsBaseUrl } from "../utils/urls.js";
import type { ModelMap } from "./models.js";

type ProviderEditorLike = {
  get(providerID: string): any;
  add(input: {
    info: any;
    models: readonly any[];
    sourceConnection?: any;
  }): void;
};

export function toV2Models(providerID: string, models: ModelMap): any[] {
  return Object.values(models).map((model) => {
    const cost = model.cost ?? ({} as ModelMap[string]["cost"]);
    const released = Date.parse(model.release_date ?? "");
    return {
      id: model.id,
      modelID: model.id,
      providerID,
      name: model.name ?? model.id,
      ...(model.family ? { family: model.family } : {}),
      capabilities: {
        tools: model.tool_call !== false,
        // The provider CLI registers every free-pi model as text-only. An
        // advertised image input would let OpenCode send media the server
        // does not accept.
        input: ["text"],
        output: ["text"],
        ...(model.temperature === undefined
          ? {}
          : { temperature: model.temperature }),
      },
      ...(model.settings ? { settings: model.settings } : {}),
      variants: Object.entries(model.variants ?? {}).map(([id, settings]) => ({
        id,
        settings,
      })),
      time: { released: Number.isFinite(released) ? released : 0 },
      cost: [
        {
          input: cost.input ?? 0,
          output: cost.output ?? 0,
          cache: {
            read: cost.cache_read ?? cost.input ?? 0,
            write: cost.cache_write ?? cost.input ?? 0,
          },
        },
      ],
      status: model.status === "deprecated" ? "deprecated" : "active",
      enabled: model.enabled !== false,
      limit: {
        context: model.limit?.context ?? CONTEXT_WINDOW,
        output: model.limit?.output ?? MAX_OUTPUT_TOKENS,
      },
    };
  });
}

export function baseProviderInfo(
  providerID: string,
  name: string,
  token: string | undefined,
): any {
  return {
    id: providerID,
    name,
    activation: "enabled",
    integrationID: PROVIDER_ID,
    package: OPENAI_COMPATIBLE_PACKAGE,
    settings: {
      baseURL: completionsBaseUrl(),
      apiKey: token ?? "free-pi",
      // free-pi is ad-supported and bills credits, so OpenCode's keep-alive
      // warmer would spend requests the provider CLI never makes. pi keeps
      // warming off for free-pi and the economics are always zero.
      cache: { warming: false },
      // Match pi's HTTP idle timeout for both response headers and chunks.
      headerTimeout: HEADER_TIMEOUT_MS,
      chunkTimeout: CHUNK_TIMEOUT_MS,
    },
  };
}

/**
 * Adds a provider, merging an existing record so user or config overrides win.
 * `editor.add` replaces the whole record, so the merge happens here.
 */
export function applyProvider(
  editor: ProviderEditorLike,
  providerID: string,
  name: string,
  models: ModelMap,
  token: string | undefined,
): void {
  const generated = toV2Models(providerID, models);
  const existing = editor.get(providerID);
  if (!existing) {
    editor.add({ info: baseProviderInfo(providerID, name, token), models: generated });
    return;
  }

  const base = baseProviderInfo(providerID, name, token);
  const info = {
    ...base,
    ...existing.provider,
    id: providerID,
    settings: {
      ...base.settings,
      ...(existing.provider?.settings ?? {}),
    },
  };

  const merged = new Map<string, any>();
  for (const model of generated) merged.set(model.id, model);
  for (const [id, model] of existing.models as ReadonlyMap<string, any>) {
    merged.set(id, { ...(merged.get(id) ?? {}), ...model });
  }

  editor.add({
    info,
    models: [...merged.values()],
    ...(existing.sourceConnection
      ? { sourceConnection: existing.sourceConnection }
      : {}),
  });
}
