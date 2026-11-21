/**
 * Spend-once cache for the free-pi tools that consume allowance.
 *
 * `web_search`, `docs_lookup` and `look_at_image` bill the user every time they
 * run. Models often ask the same question twice in a turn (or a subagent and
 * its lead both ask it), so identical inputs reuse the first answer instead of
 * spending credits again. Failures are never cached: the next attempt must
 * reach the server and see the real error. Concurrent identical calls share one
 * in-flight request, so a parallel tool call cannot double-charge either.
 */

import type { Deps } from "../deps.js";
import type { ToolOutput } from "./api.js";

/** Long enough to cover a turn and its follow-ups, short enough to stay fresh. */
export const SPEND_CACHE_TTL_MS = 30 * 60 * 1_000;
const SPEND_CACHE_LIMIT = 128;

type Entry = {
  readonly at: number;
  readonly output: ToolOutput;
};

function trim(deps: Deps): void {
  const now = Date.now();
  for (const [key, entry] of deps.state.toolSpend) {
    if (now - entry.at >= SPEND_CACHE_TTL_MS) deps.state.toolSpend.delete(key);
  }
  while (deps.state.toolSpend.size > SPEND_CACHE_LIMIT) {
    const oldest = deps.state.toolSpend.keys().next().value;
    if (oldest === undefined) break;
    deps.state.toolSpend.delete(oldest);
  }
}

function cachedResult(entry: Entry): ToolOutput {
  const { cost_usd: _spent, ...metadata } = entry.output.metadata;
  return {
    content: entry.output.content.map((part) => ({
      type: "text" as const,
      text: `${part.text}\n\n(cached answer from earlier - no allowance used)`,
    })),
    metadata: { ...metadata, cached: true },
  };
}

export async function spendOnce(
  deps: Deps,
  key: string,
  run: () => Promise<ToolOutput>,
): Promise<ToolOutput> {
  const entry = deps.state.toolSpend.get(key);
  if (entry && Date.now() - entry.at < SPEND_CACHE_TTL_MS) {
    deps.log.info("reused a cached free-pi tool answer", { key });
    return cachedResult(entry);
  }

  const pending = deps.state.toolSpendPending.get(key);
  if (pending) {
    const output = await pending;
    return output.metadata.ok
      ? cachedResult({ at: Date.now(), output })
      : run();
  }

  const request = run();
  deps.state.toolSpendPending.set(key, request);
  try {
    const output = await request;
    if (output.metadata.ok) {
      deps.state.toolSpend.set(key, { at: Date.now(), output });
      trim(deps);
    }
    return output;
  } finally {
    if (deps.state.toolSpendPending.get(key) === request)
      deps.state.toolSpendPending.delete(key);
  }
}
