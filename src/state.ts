/** Per-plugin-instance mutable state. */

import { DEFAULT_CLIENT_VERSION } from "./constants.js";
import type {
  AdTurn,
  CacheMissState,
  Catalog,
  FreePiError,
  ModelRegistry,
  QuotaSnapshot,
  RequestUsage,
  SessionResetOutcome,
  TokenCheckState,
  ToolStats,
  TrackedModel,
} from "./types.js";

export type RuntimeState = {
  latestClientVersion: string;
  providerToken?: string;

  cachedCatalog?: Catalog;
  cachedCatalogAt: number;
  catalogPromise?: Promise<Catalog | undefined>;
  cachedRegistry?: ModelRegistry;
  cachedRegistryAt: number;
  registryAttemptAt: number;
  registryPromise?: Promise<ModelRegistry | undefined>;
  costExperimentArm?: string;
  lastCatalogNotice?: string;
  lastQuotaNotice?: string;
  catalogModels: Catalog;
  outputLimits: Map<string, number>;

  quotaCache?: QuotaSnapshot;
  quotaPromise?: Promise<QuotaSnapshot>;
  lastQuotaRefreshAt: number;

  lastUsage?: RequestUsage;
  lastUsageMessageID?: string;
  lastFreePiError?: FreePiError;
  lastErrorLogKey?: string;
  lastErrorLogAt: number;
  lastInvalidToken?: string;
  tokenChecks: Map<string, { at: number; state: TokenCheckState }>;
  lastExpiredToken?: string;

  sessionClosePromises: Map<string, Promise<void>>;
  sessionResetPromise?: Promise<SessionResetOutcome>;
  lastSessionResetAt: number;

  freePiSessions: Set<string>;
  wireSessions: Map<string, string>;
  wireHydrated: Set<string>;
  replayBodies: Map<string, string>;
  /** Rejections of requests that fit the model window, per session. */
  spuriousOverflows: Map<string, { at: number; count: number }>;
  dirtySessions: Set<string>;
  finalizedSessions: Set<string>;
  activeExecutions: Set<string>;
  sessionActivity: Map<string, number>;
  finalizeTimers: Map<string, ReturnType<typeof setTimeout>>;
  adTurns: Map<string, AdTurn>;
  pendingAdTurns: Map<string, AdTurn>;
  adImpressions: Map<string, Promise<void>>;
  trackedModels: Map<string, TrackedModel>;
  cacheMisses: Map<string, CacheMissState>;
  toolStats: Map<string, ToolStats>;
  /** Successful paid-tool answers, keyed by canonical input, to avoid rebilling. */
  toolSpend: Map<
    string,
    {
      at: number;
      output: {
        content: ReadonlyArray<{ type: "text"; text: string }>;
        metadata: Record<string, unknown>;
      };
    }
  >;
  toolSpendPending: Map<string, Promise<any>>;
  subagentSessions: Set<string>;
};

export function createRuntimeState(): RuntimeState {
  return {
    latestClientVersion: DEFAULT_CLIENT_VERSION,
    cachedCatalogAt: 0,
    cachedRegistryAt: 0,
    registryAttemptAt: 0,
    catalogModels: {},
    outputLimits: new Map(),
    lastQuotaRefreshAt: 0,
    lastErrorLogAt: 0,
    tokenChecks: new Map(),
    sessionClosePromises: new Map(),
    lastSessionResetAt: 0,
    freePiSessions: new Set(),
    wireSessions: new Map(),
    wireHydrated: new Set(),
    replayBodies: new Map(),
    spuriousOverflows: new Map(),
    dirtySessions: new Set(),
    finalizedSessions: new Set(),
    activeExecutions: new Set(),
    sessionActivity: new Map(),
    finalizeTimers: new Map(),
    adTurns: new Map(),
    pendingAdTurns: new Map(),
    adImpressions: new Map(),
    trackedModels: new Map(),
    cacheMisses: new Map(),
    toolStats: new Map(),
    toolSpend: new Map(),
    toolSpendPending: new Map(),
    subagentSessions: new Set(),
  };
}
