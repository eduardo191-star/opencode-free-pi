/**
 * Logs the two server notices the free-pi CLI watches for: the
 * `x-freepi-notice` header and the `: freepi_notice` SSE marker sent when the
 * server restarts.
 */
import type { Deps } from "../deps.js";
export declare function watchFreePiNotice(deps: Deps, response: Response): Response;
