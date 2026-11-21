/** Turns the free-pi catalog and models.dev registry into model definitions. */
import type { Catalog, CatalogModel, ModelDefinition, ModelRegistry, ModelsDevModel, ReasoningOption, RegistryCandidate } from "../types.js";
export type VariantMap = Record<string, Record<string, unknown>>;
export type ModelMap = Record<string, ModelDefinition>;
export declare function usableModels(catalog: Catalog | undefined): CatalogModel[];
export declare function partitionModels(catalog: Catalog | undefined): {
    main: CatalogModel[];
    defense: CatalogModel[];
};
export declare function displayName(model: CatalogModel): string;
export declare function modelCost(model: CatalogModel, capability?: ModelsDevModel): ModelDefinition["cost"];
export declare function modelRegistryCandidates(registry: ModelRegistry | undefined): RegistryCandidate[];
export declare function modelCapability(model: CatalogModel, candidates: RegistryCandidate[]): ModelsDevModel | undefined;
export declare function modelVariants(options: ReasoningOption[] | undefined, outputLimit: number): VariantMap;
export declare function buildModels(models: CatalogModel[], candidates?: RegistryCandidate[]): ModelMap;
