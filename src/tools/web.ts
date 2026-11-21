/**
 * `web_search` and `docs_lookup`, backed by free-pi's `/tools/*` endpoints.
 *
 * Both spend part of the user's daily allowance, exactly like the provider
 * CLI, and are only exposed inside free-pi sessions.
 */

import type { Plugin } from "@opencode/plugin";
import type { Deps } from "../deps.js";
import {
  done,
  fail,
  freePiRequest,
  GATED_TEXT,
  isGatedSession,
  mappedText,
} from "./api.js";

const ERRORS: Record<string, string> = {
  daily_cap:
    "The user's daily free usage is used up. Do not retry; tell the user and continue without this tool.",
  rolling_cap:
    "The user's short-term usage limit is reached. Do not retry; continue without this tool.",
  rate_limited:
    "Too many calls right now. Wait for the current call to finish, and do not call again in this turn unless needed.",
  not_found:
    'No documentation library matched the requested name. Retry once with the package\'s exact name, or use web_search.',
  not_configured:
    "This tool is not available on this server. Do not call it again in this session.",
  upstream_error: "The search provider failed. You may retry once.",
  guest_login_required:
    "This tool needs a GitHub sign-in; the guest trial cannot use it. Do not retry; tell the user to sign in, and continue without this tool.",
  guest_unavailable:
    "The guest trial is not available right now. Do not retry; tell the user to sign in with GitHub, and continue without this tool.",
  invalid_request:
    "The server rejected this request. Do not retry it unchanged.",
};

const WEB_INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description:
        'Specific query as you would type it into a search engine, e.g. "vite 6 release notes breaking changes"',
    },
    num_results: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      description: "1-10, default 5; use 3 for a quick fact, 8-10 for a survey",
    },
  },
} as const;

const DOCS_INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["library", "query"],
  properties: {
    library: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description:
        'Package or library name, e.g. "next.js", "prisma", "@tanstack/react-query"',
    },
    query: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description:
        'One specific question, e.g. "configure middleware matcher for API routes"',
    },
    library_id: {
      type: "string",
      description:
        "The library_id printed by an earlier docs_lookup, e.g. /vercel/next.js; skips the name search",
    },
  },
} as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function formatWebResults(query: string, results: any[]): string {
  if (!Array.isArray(results) || results.length === 0) {
    return `No results for "${query}". Try a broader or differently worded query.`;
  }
  return `Web results for "${query}":\n\n${results
    .map((item, index) => {
      const published = item?.published_date
        ? `\nPublished: ${item.published_date}`
        : "";
      return `${index + 1}. ${item?.title ?? ""}\n${item?.url ?? ""}${published}\n${item?.text ?? item?.content ?? ""}`;
    })
    .join("\n\n")}`;
}

async function executeWebSearch(
  deps: Deps,
  raw: unknown,
  context: { readonly sessionID: string; readonly signal: AbortSignal },
) {
  if (!isGatedSession(deps, context.sessionID)) return fail(GATED_TEXT);
  const input = raw as any;
  const query = text(input?.query);
  if (!query) return fail("web_search needs a query.");
  const num =
    typeof input?.num_results === "number" ? input.num_results : undefined;

  const result = await freePiRequest(deps, {
    path: "/tools/web-search",
    method: "POST",
    body: { query, ...(num !== undefined ? { num_results: num } : {}) },
    timeoutMs: 30_000,
    signal: context.signal,
    label: "The web search",
  });
  if (!result.ok) return fail(mappedText(ERRORS, result));

  deps.log.info("web_search answered", {
    query,
    results: Array.isArray(result.data?.results)
      ? result.data.results.length
      : 0,
    costUsd: result.data?.cost_usd,
  });
  return done(formatWebResults(query, result.data?.results ?? []), {
    ok: true,
    ...(typeof result.data?.cost_usd === "number"
      ? { cost_usd: result.data.cost_usd }
      : {}),
  });
}

async function executeDocsLookup(
  deps: Deps,
  raw: unknown,
  context: { readonly sessionID: string; readonly signal: AbortSignal },
) {
  if (!isGatedSession(deps, context.sessionID)) return fail(GATED_TEXT);
  const input = raw as any;
  const library = text(input?.library);
  const query = text(input?.query);
  const libraryId = text(input?.library_id);
  if (!library) return fail("docs_lookup needs a library name.");
  if (!query) return fail("docs_lookup needs a specific question.");

  const result = await freePiRequest(deps, {
    path: "/tools/docs",
    method: "POST",
    body: {
      library,
      query,
      ...(libraryId ? { library_id: libraryId } : {}),
    },
    timeoutMs: 30_000,
    signal: context.signal,
    label: "The documentation lookup",
  });
  if (!result.ok) return fail(mappedText(ERRORS, result, library));

  const data = result.data ?? {};
  deps.log.info("docs_lookup answered", {
    library,
    libraryID: data.library_id,
    costUsd: data.cost_usd,
  });
  return done(
    `${data.title ?? library} (library_id: ${data.library_id ?? "unknown"})\n\n${data.docs ?? ""}`,
    {
      ok: true,
      library_id: data.library_id,
      ...(typeof data.cost_usd === "number"
        ? { cost_usd: data.cost_usd }
        : {}),
    },
  );
}

export async function registerWebTools(
  ctx: Plugin.Context,
  deps: Deps,
): Promise<{ dispose: () => Promise<void> }> {
  return ctx.tool.transform((editor) => {
    editor.add({
      name: "web_search",
      description:
        "Search the web and return a numbered list of results, each with title, URL, publish date and page text. Use it for current or recent information that your training data may lack. Each call uses part of the user's daily allowance.",
      input: WEB_INPUT,
      options: { codemode: false },
      execute: (input: unknown, context: any) =>
        executeWebSearch(deps, input, context),
    } as any);

    editor.add({
      name: "docs_lookup",
      description:
        "Look up current documentation for a third-party library, framework or API. Returns the matching library's title and library_id, then documentation text relevant to your query. Use it instead of relying on memory for exact signatures and options. Each call uses part of the user's daily allowance.",
      input: DOCS_INPUT,
      options: { codemode: false },
      execute: (input: unknown, context: any) =>
        executeDocsLookup(deps, input, context),
    } as any);
  });
}
