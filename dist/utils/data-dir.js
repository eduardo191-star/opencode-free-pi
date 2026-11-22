/** Per-user directory for the files the plugin keeps between runs. */
import { homedir } from "node:os";
import { join } from "node:path";
export function dataDir() {
    const configured = process.env.FREE_PI_DATA_DIR?.trim();
    if (configured)
        return configured;
    return join(homedir(), ".cache", "opencode", "free-pi");
}
export function dataPath(name) {
    return join(dataDir(), name);
}
