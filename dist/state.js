/** Per-plugin-instance mutable state. */
import { DEFAULT_CLIENT_VERSION } from "./constants.js";
export function createRuntimeState() {
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
        fusionSessions: new Set(),
        wireSessions: new Map(),
        replayBodies: new Map(),
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
        subagentSessions: new Set(),
    };
}
