/**
 * Live limits and capabilities.
 *
 * free-pi's HTTP API never publishes per-model limits: `/client-version` only
 * carries id/name/free/section/note/stats_id, `/me` carries the quota, and chat
 * responses carry usage but no window. The gateway does enforce a real ceiling,
 * so the plugin verifies the advertised window against the gateway itself and
 * remembers what it learned. The measured value replaces the compiled default
 * on the next start; a probe failure leaves the previous value untouched.
 */
import type { Deps } from "../deps.js";
import type { TokenUsageLike } from "../types.js";
export type ModelObservation = {
    /** Largest prompt the gateway accepted for this model. */
    maxPromptTokens?: number;
    /** Whether a real response carried reasoning tokens. */
    reasoning?: boolean;
    updatedAt: number;
};
export type LiveLimits = {
    version: 1;
    /** Window verified against the gateway, used for the next catalog build. */
    window?: {
        tokens: number;
        verifiedAt: number;
        model?: string;
    };
    /** What real traffic showed for each model. */
    models: Record<string, ModelObservation>;
};
/** Reads the persisted measurements once per process. Never throws. */
export declare function loadLiveLimits(): Promise<LiveLimits>;
/** The measurements loaded for this process. */
export declare function currentLiveLimits(): LiveLimits | undefined;
/**
 * Folds a real step's usage into the model's record: the prompt size proves the
 * gateway accepted at least that much context, and reasoning tokens prove the
 * model really reasoned for this account.
 */
export declare function noteStepTokens(_deps: Deps, modelID: string, tokens: TokenUsageLike | undefined): void;
/** Whether the persisted window is old enough to verify again. */
export declare function shouldVerifyWindow(limits: LiveLimits | undefined): boolean;
export type VerifyLimitsOptions = {
    /** A free model to probe with; paid models would spend credits. */
    model?: string;
    /** Window to check. Defaults to the compiled one. */
    window?: number;
};
/**
 * Checks the compiled window against the gateway by sending the largest prompt
 * that window allows. On rejection it steps down until the gateway accepts, so
 * the next catalog build advertises what the server really takes. Returns the
 * verified window, or `undefined` when nothing could be learned.
 */
export declare function verifyGatewayWindow(deps: Deps, options?: VerifyLimitsOptions): Promise<number | undefined>;
