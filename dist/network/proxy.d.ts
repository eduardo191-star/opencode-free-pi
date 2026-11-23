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
import type { Logger } from "../logging.js";
/** First proxy URL exported in the environment, or undefined. */
export declare function proxyFromEnvironment(env?: NodeJS.ProcessEnv): string | undefined;
/**
 * Enables the environment proxy for this process when one is configured.
 * Returns whether the plugin will use it.
 */
export declare function applyEnvironmentProxy(log: Logger, env?: NodeJS.ProcessEnv): boolean;
