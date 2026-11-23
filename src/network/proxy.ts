/**
 * Honors the proxy a VPN or corporate network exports in the environment.
 *
 * The free-pi CLI reads `*_proxy`/`all_proxy` and routes its requests through
 * an agent, so it keeps working when the network only allows traffic through a
 * local proxy. Node's `fetch` ignores those variables unless the process opts
 * in, which left the plugin unable to fetch the catalog, quota, ads or replay a
 * request while the CLI worked. `http.setGlobalProxyFromEnv()` (Node 24.5+)
 * turns the environment proxy on for every request of this process, including
 * `fetch`; when the runtime is older the plugin keeps going direct and says so.
 */

import http from "node:http";
import type { Logger } from "../logging.js";

const PROXY_VARIABLES = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

/** First proxy URL exported in the environment, or undefined. */
export function proxyFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const name of PROXY_VARIABLES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Proxy URL without credentials, safe for the log. */
function describeProxy(value: string): string {
  try {
    const url = new URL(value);
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${url.hostname}${port}`;
  } catch {
    return "configured";
  }
}

type ProxySetter = () => unknown;

function proxySetter(): ProxySetter | undefined {
  const candidate = (http as { setGlobalProxyFromEnv?: unknown })
    .setGlobalProxyFromEnv;
  return typeof candidate === "function"
    ? (candidate as ProxySetter)
    : undefined;
}

/**
 * Enables the environment proxy for this process when one is configured.
 * Returns whether the plugin will use it.
 */
export function applyEnvironmentProxy(log: Logger): boolean {
  const proxy = proxyFromEnvironment();
  if (!proxy) return false;
  const setter = proxySetter();
  if (!setter) {
    log.warn(
      "free-pi found a proxy in the environment but this Node runtime cannot apply it; start OpenCode with NODE_USE_ENV_PROXY=1 or use Node 24.5+ so free-pi requests follow the proxy",
      { node: process.version, proxy: describeProxy(proxy) },
    );
    return false;
  }
  try {
    setter();
    log.info("free-pi requests follow the proxy configured in the environment", {
      proxy: describeProxy(proxy),
    });
    return true;
  } catch (error) {
    log.warn("free-pi could not enable the environment proxy", {
      proxy: describeProxy(proxy),
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
