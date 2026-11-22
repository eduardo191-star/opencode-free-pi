/**
 * Tool outcome headers, mirroring the free-pi provider CLI's
 * `free-pi-tool-outcomes` extension:
 *
 * - `x-freepi-tool-meta: v1:<id>~<ms>~<exit>~<truncated>,...`
 * - `x-freepi-tool-errors: v1:<ids>` (`v1x:` once old IDs were evicted)
 * - `x-freepi-compacted: v1:<dropped messages>` on the request after compaction
 */
import { COMPACTED_HEADER, DEFENSE_PROVIDER_ID, PROVIDER_ID, TOOL_ERRORS_HEADER, TOOL_ID_LIMIT, TOOL_META_BUDGET, TOOL_META_HEADER, } from "../constants.js";
import { trimMap } from "../utils/async.js";
const ID_PATTERN = /^[\w.:-]{1,100}$/;
const MAX_ENTRY_LENGTH = 150;
const MAX_STARTED = 200;
/**
 * Every tool this plugin adds. They are registered globally because OpenCode's
 * tool editor has no provider filter, so the plugin hides them from requests
 * served by another provider (see `hideFreePiTools`) and refuses to run them
 * outside a free-pi session.
 */
export const FREE_PI_TOOL_NAMES = [
    "look_at_image",
    "free_pi_usage",
    "web_search",
    "docs_lookup",
    "generate_image",
];
/**
 * Whether this session is currently served by free-pi. The last request's
 * model wins over the historical set, so a session that switches to another
 * provider stops seeing free-pi's tools and headers immediately.
 */
export function isFreePiSession(deps, sessionID) {
    const tracked = deps.state.trackedModels.get(sessionID);
    if (tracked) {
        return (tracked.providerID === PROVIDER_ID ||
            tracked.providerID === DEFENSE_PROVIDER_ID);
    }
    return deps.state.freePiSessions.has(sessionID);
}
function statsFor(deps, sessionID) {
    let stats = deps.state.toolStats.get(sessionID);
    if (!stats) {
        stats = {
            meta: [],
            metaBytes: 3,
            failed: [],
            evicted: false,
            started: new Map(),
            compacted: 0,
        };
        trimMap(deps.state.toolStats, 200);
        deps.state.toolStats.set(sessionID, stats);
    }
    return stats;
}
function shellExit(stats) {
    if (stats.status === "error")
        return "-";
    const exit = stats.result?.metadata?.exit;
    return typeof exit === "number" ? String(exit) : "0";
}
function truncated(stats) {
    const metadata = stats.result?.metadata;
    if (metadata?.truncated === true)
        return true;
    const truncation = metadata?.truncation;
    return Boolean(truncation &&
        typeof truncation === "object" &&
        truncation.truncated === true);
}
export function recordToolStart(deps, sessionID, id) {
    if (!isFreePiSession(deps, sessionID) || !ID_PATTERN.test(id))
        return;
    const stats = statsFor(deps, sessionID);
    stats.started.set(id, Date.now());
    if (stats.started.size <= MAX_STARTED)
        return;
    const oldest = stats.started.keys().next().value;
    if (oldest !== undefined)
        stats.started.delete(oldest);
}
export function recordToolEnd(deps, sessionID, end) {
    if (!isFreePiSession(deps, sessionID) || !ID_PATTERN.test(end.id))
        return;
    const stats = statsFor(deps, sessionID);
    const startedAt = stats.started.get(end.id);
    stats.started.delete(end.id);
    const duration = startedAt === undefined ? 0 : Date.now() - startedAt;
    const entry = `${end.id}~${Math.max(0, Math.round(duration))}~${shellExit(end)}~${truncated(end) ? 1 : 0}`;
    if (entry.length <= MAX_ENTRY_LENGTH) {
        stats.meta.push(entry);
        stats.metaBytes += entry.length + 1;
        while (stats.metaBytes > TOOL_META_BUDGET && stats.meta.length > 1) {
            const removed = stats.meta.shift();
            stats.metaBytes -= (removed?.length ?? 0) + 1;
        }
    }
    if (end.status !== "error")
        return;
    stats.failed.push(end.id);
    if (stats.failed.length <= TOOL_ID_LIMIT)
        return;
    stats.failed.shift();
    stats.evicted = true;
}
export function recordCompaction(deps, sessionID, droppedMessages) {
    if (!isFreePiSession(deps, sessionID) || droppedMessages <= 0)
        return;
    const stats = statsFor(deps, sessionID);
    stats.compacted += droppedMessages;
}
/**
 * Headers for the outgoing request. `consumeCompacted` is false for the
 * compaction request itself so the marker lands on the request that follows.
 */
export function toolHeaders(deps, sessionID, consumeCompacted) {
    const stats = deps.state.toolStats.get(sessionID);
    const headers = {};
    if (stats?.meta.length) {
        headers[TOOL_META_HEADER] = `v1:${stats.meta.join(",")}`;
    }
    if (stats && consumeCompacted && stats.compacted > 0) {
        headers[COMPACTED_HEADER] = `v1:${stats.compacted}`;
        stats.compacted = 0;
    }
    headers[TOOL_ERRORS_HEADER] = `${stats?.evicted ? "v1x" : "v1"}:${(stats?.failed ?? []).join(",")}`;
    return headers;
}
export function forgetToolStats(deps, sessionID) {
    deps.state.toolStats.delete(sessionID);
}
