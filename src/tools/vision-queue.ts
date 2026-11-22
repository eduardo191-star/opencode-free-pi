/**
 * Serializes vision questions across sessions and OpenCode processes.
 *
 * free-pi answers one `/tools/vision` request at a time: a second concurrent
 * question gets `rate_limited`. OpenCode can run several sessions, and users can
 * run several OpenCode processes, so calls are queued in-process and coordinated
 * through a lock directory in the free-pi data directory.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logging.js";
import { dataDir } from "../utils/data-dir.js";

type Owner = { pid: number; startedAt: number; id: string };

const OWNER_FILE = "owner.json";
const POLL_MS = 350;
/** A live owner may legitimately hold the lock for a 90 s request. */
const STALE_MS = 10 * 60_000;
const MAX_WAIT_MS = 120_000;

let chain: Promise<void> = Promise.resolve();

function lockDir(): string {
  return join(dataDir(), "vision.lock");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function createLock(dir: string, owner: Owner): Promise<boolean> {
  try {
    await mkdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    await writeFile(join(dir, OWNER_FILE), JSON.stringify(owner), "utf8");
  } catch {
    // The owner file is a convenience; the directory itself is the lock.
  }
  return true;
}

async function abandoned(dir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(dir, OWNER_FILE), "utf8");
    const owner = JSON.parse(raw) as Partial<Owner>;
    if (typeof owner.pid === "number") return !pidAlive(owner.pid);
  } catch {
    // Written just after the directory is created, so it can be briefly absent.
  }
  try {
    const info = await stat(dir);
    return Date.now() - info.mtimeMs > STALE_MS;
  } catch {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Slot = {
  readonly release: () => Promise<void>;
  readonly waitedMs: number;
};

async function acquire(log: Logger): Promise<Slot | undefined> {
  const dir = lockDir();
  const owner: Owner = {
    pid: process.pid,
    startedAt: Date.now(),
    id: randomUUID(),
  };
  const startedAt = Date.now();

  try {
    await mkdir(dataDir(), { recursive: true });
  } catch {
    // Without a data directory the file lock is unavailable; the in-process
    // queue still serializes calls, so keep going.
  }

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    try {
      if (await createLock(dir, owner)) {
        return {
          waitedMs: Date.now() - startedAt,
          release: async () => {
            try {
              const raw = await readFile(join(dir, OWNER_FILE), "utf8");
              if ((JSON.parse(raw) as Owner).id !== owner.id) return;
            } catch {
              // Fall through and remove the lock we created.
            }
            await rm(dir, { recursive: true, force: true }).catch(() => {});
          },
        };
      }
    } catch (error) {
      log.warn("look_at_image could not use the shared vision lock", {
        error: String(error),
      });
      return { waitedMs: 0, release: async () => {} };
    }

    if (await abandoned(dir)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    await sleep(POLL_MS + Math.floor(Math.random() * 100));
  }

  return undefined;
}

/**
 * Runs `run` while holding the vision slot. Returns `ok: false` when another
 * process kept the slot occupied for longer than the queue budget.
 */
export async function withVisionSlot<T>(
  log: Logger,
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  // Queue inside this process first: several sessions share the same module.
  const previous = chain;
  let releaseChain: () => void = () => {};
  chain = new Promise<void>((resolve) => {
    releaseChain = resolve;
  });
  await previous.catch(() => {});

  try {
    const slot = await acquire(log);
    if (!slot) return { ok: false };
    if (slot.waitedMs > 500) {
      log.info("look_at_image waited for the previous image question", {
        waitedMs: slot.waitedMs,
      });
    }
    try {
      return { ok: true, value: await run() };
    } finally {
      await slot.release();
    }
  } finally {
    releaseChain();
  }
}
