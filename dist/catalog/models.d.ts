/** Turns the free-pi catalog and models.dev registry into model definitions. */
import type { Catalog, CatalogModel, MeResponse, ModelDefinition, ModelRegistry, ModelsDevModel, ReasoningOption, RegistryCandidate } from "../types.js";
export type VariantMap = Record<string, Record<string, unknown>>;
export type ModelMap = Record<string, ModelDefinition>;
export declare function usableModels(catalog: Catalog | undefined): CatalogModel[];
export declare function partitionModels(catalog: Catalog | undefined): {
    main: CatalogModel[];
    defense: CatalogModel[];
};
export declare function displayName(model: CatalogModel): string;
export declare function modelCost(_model: CatalogModel, _capability?: ModelsDevModel): ModelDefinition["cost"];
export declare function modelRegistryCandidates(registry: ModelRegistry | undefined): RegistryCandidate[];
export declare function modelCapability(model: CatalogModel, candidates: RegistryCandidate[]): ModelsDevModel | undefined;
export declare function modelVariants(options: ReasoningOption[] | undefined, _outputLimit: number): VariantMap;
export type BuildModelsOptions = {
    /** pi's `compact100` arm compacts at 100k instead of the default ceiling. */
    compact100?: boolean;
};
/**
 * What the signed-in account can actually use, derived from `GET /me`.
 *
 * free-pi lets the free allowance pay for every non-premium model while the
 * daily credits last, so those stay available even when the wallet is empty.
 * Premium-only models need premium credits, and showing them to an account
 * without any only produces `model_requires_credits` failures from `/model`.
 */
export type AccountAccess = {
    readonly premiumCredits: number;
    readonly walletCredits: number;
    readonly remainingCredits: number;
    readonly hasAllowance: boolean;
};
export declare function accountAccess(me: MeResponse | undefined): AccountAccess | undefined;
export declare function filterAccessibleModels(models: CatalogModel[], access: AccountAccess | undefined): CatalogModel[];
export declare function buildModels(models: CatalogModel[], candidates?: RegistryCandidate[], options?: BuildModelsOptions): ModelMap;
