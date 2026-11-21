/** URL resolution and validation. */

import {
  DEFAULT_BASE_URL,
  DEFAULT_MODELS_REGISTRY_URL,
} from "../constants.js";

export function resolveBaseUrl(): string {
  const configured = process.env.FREEPI_BASE_URL?.trim();
  return (configured || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function completionsBaseUrl(): string {
  const base = resolveBaseUrl();
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export function modelsRegistryUrl(): string {
  const configured =
    process.env.FREEPI_MODELS_URL?.trim() ||
    process.env.OPENCODE_MODELS_URL?.trim();
  return (configured || DEFAULT_MODELS_REGISTRY_URL).replace(/\/+$/, "");
}

export function normalizeIssuer(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.origin
      : undefined;
  } catch {
    return undefined;
  }
}

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}
