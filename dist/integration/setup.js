/** Registers the free-pi integration and its sign-in methods. */
import { authorizeFreePi } from "../auth/authorize.js";
import { fetchCatalog } from "../catalog/catalog.js";
import { PROVIDER_ID } from "../constants.js";
export async function registerIntegration(ctx, deps) {
    await ctx.integration.transform((editor) => {
        editor.method.update({
            integrationID: PROVIDER_ID,
            method: {
                id: "github",
                type: "oauth",
                label: "Sign in with GitHub (free-pi)",
            },
            authorize: async () => {
                const result = await authorizeFreePi({
                    log: deps.log,
                    clientVersion: deps.state.latestClientVersion,
                    warmCatalog: () => fetchCatalog(deps),
                });
                return {
                    url: result.url,
                    instructions: result.instructions,
                    mode: "auto",
                    callback: result.callback,
                };
            },
        });
        editor.method.update({
            integrationID: PROVIDER_ID,
            method: {
                type: "key",
                label: "Paste a free-pi JWT",
            },
        });
        editor.method.update({
            integrationID: PROVIDER_ID,
            method: {
                type: "env",
                names: ["FREEPI_JWT"],
            },
        });
        // `method.update` creates the integration implicitly; name it when present.
        if (editor.get(PROVIDER_ID)) {
            editor.update(PROVIDER_ID, (integration) => {
                integration.name = "Free Pi";
            });
        }
    });
}
