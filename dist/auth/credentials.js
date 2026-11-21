/** The free-pi credential file written by the free-pi CLI. */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeIssuer, resolveBaseUrl } from "../utils/urls.js";
export function credentialsPath() {
    const override = process.env.FREEPI_CREDENTIALS_PATH?.trim();
    if (override)
        return resolve(override);
    return join(homedir(), ".free-pi", "agent", "credentials.json");
}
export function credentialsDisplayPath() {
    const override = process.env.FREEPI_CREDENTIALS_PATH?.trim();
    if (override)
        return override;
    return process.platform === "win32"
        ? join("%USERPROFILE%", ".free-pi", "agent", "credentials.json")
        : "~/.free-pi/agent/credentials.json";
}
export async function readCredentials() {
    const envToken = process.env.FREEPI_JWT?.trim();
    if (envToken)
        return { token: envToken, issuer: resolveBaseUrl() };
    try {
        const raw = await readFile(credentialsPath(), "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed.token !== "string" || parsed.token.length === 0)
            return undefined;
        const issuer = normalizeIssuer(parsed.issuer);
        return issuer ? { token: parsed.token, issuer } : { token: parsed.token };
    }
    catch {
        return undefined;
    }
}
export async function readCredentialsToken() {
    return (await readCredentials())?.token;
}
export async function writeCredentials(token, issuer) {
    const path = credentialsPath();
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    const record = issuer
        ? { token, issuer: normalizeIssuer(issuer) ?? issuer }
        : { token };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    try {
        await rename(temporary, path);
    }
    catch (error) {
        if (process.platform !== "win32")
            throw error;
        await rm(path, { force: true });
        await rename(temporary, path);
    }
}
