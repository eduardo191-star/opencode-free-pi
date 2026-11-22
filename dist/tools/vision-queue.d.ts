/**
 * Serializes vision questions across sessions and OpenCode processes.
 *
 * free-pi answers one `/tools/vision` request at a time: a second concurrent
 * question gets `rate_limited`. OpenCode can run several sessions, and users can
 * run several OpenCode processes, so calls are queued in-process and coordinated
 * through a lock directory in the free-pi data directory.
 */
import type { Logger } from "../logging.js";
/**
 * Runs `run` while holding the vision slot. Returns `ok: false` when another
 * process kept the slot occupied for longer than the queue budget.
 */
export declare function withVisionSlot<T>(log: Logger, run: () => Promise<T>): Promise<{
    ok: true;
    value: T;
} | {
    ok: false;
}>;
