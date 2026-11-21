/** Best-effort JSON cache on disk for data fetched over the network. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type CacheEntry<T> = { at: number; value: T };

export function cacheDir(): string {
  const configured = process.env.FREE_PI_CACHE_DIR?.trim();
  if (configured) return configured;
  return join(homedir(), ".cache", "opencode", "free-pi");
}

export function cachePath(name: string): string {
  return join(cacheDir(), name);
}

/** Reads a cached value when it is younger than `ttlMs`. Never throws. */
export async function readCache<T>(
  name: string,
  ttlMs: number,
): Promise<T | undefined> {
  try {
    const raw = await readFile(cachePath(name), "utf8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry.at !== "number") return undefined;
    if (!Number.isFinite(entry.at)) return undefined;
    if (Date.now() - entry.at > ttlMs) return undefined;
    return entry.value;
  } catch {
    return undefined;
  }
}

/** Writes a value atomically. Never throws. */
export async function writeCache<T>(name: string, value: T): Promise<void> {
  try {
    const file = cachePath(name);
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;
    await writeFile(temp, JSON.stringify({ at: Date.now(), value }), "utf8");
    await rename(temp, file);
  } catch {
    // The cache is an optimization; failures must not affect the plugin.
  }
}
