/** Converts internal model definitions into OpenCode V2 provider records. */
import type { ModelMap } from "./models.js";
type ProviderEditorLike = {
    get(providerID: string): any;
    add(input: {
        info: any;
        models: readonly any[];
        sourceConnection?: any;
    }): void;
};
export declare function toV2Models(providerID: string, models: ModelMap): any[];
export declare function baseProviderInfo(providerID: string, name: string, token: string | undefined): any;
/**
 * Adds a provider, merging an existing record so user or config overrides win.
 * `editor.add` replaces the whole record, so the merge happens here.
 */
export declare function applyProvider(editor: ProviderEditorLike, providerID: string, name: string, models: ModelMap, token: string | undefined): void;
export {};
