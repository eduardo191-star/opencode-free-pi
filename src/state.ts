/** Per-plugin-instance mutable state. */

import { DEFAULT_CLIENT_VERSION } from "./constants.js";
import type {
  AdTurn,
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
  lastCatalogNotice?: string;
  lastQuotaNotice?: string;
  catalogModels: Catalog;
  outputLimits: Map<string, number>;
  /** Advertised context window per `provider/model`, for request trimming. */
  contextLimits: Map<string, number>;
  /** `provider/model` ids whose upstream accepts image input. */
  imageModels: Set<string>;

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
  toolStats: Map<string, ToolStats>;
  subagentSessions: Set<string>;
  /** Newest turns quoted at the last compaction, carried once into the next request. */
  recentWindows: Map<string, { at: number; text: string }>;
};

export function createRuntimeState(): RuntimeState {
  return {
    latestClientVersion: DEFAULT_CLIENT_VERSION,
    cachedCatalogAt: 0,
    cachedRegistryAt: 0,
    registryAttemptAt: 0,
    catalogModels: {},
    outputLimits: new Map(),
    contextLimits: new Map(),
    imageModels: new Set(),
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
    toolStats: new Map(),
    subagentSessions: new Set(),
    recentWindows: new Map(),
  };
}
