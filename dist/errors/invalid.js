/** Warns once when the stored free-pi credential is rejected. */
export async function logInvalidToken(deps, token) {
    const key = token ?? "(none)";
    if (deps.state.lastInvalidToken === key)
        return;
    deps.state.lastInvalidToken = key;
    deps.log.warn("free-pi sign-in is invalid or expired. Run `opencode auth login -p free-pi` to sign in again.");
}
