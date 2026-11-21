/** Numeric and human-readable formatting helpers. */

import { CREDITS_PER_USD } from "../constants.js";

export function duplicateNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function positiveNumber(
  ...values: Array<number | undefined>
): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

export function creditsToUsd(credits: number | undefined): number {
  return typeof credits === "number" && Number.isFinite(credits) && credits > 0
    ? credits / CREDITS_PER_USD
    : 0;
}

export function formatRefillTime(value: string | undefined): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  try {
    return date.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return date.toISOString();
  }
}

export function formatWait(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0)
    return undefined;
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return "about a minute";
  if (minutes < 60) return `about ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours}h ${rest}m` : `about ${hours}h`;
}
