/** Logging for the plugin. V2 has no `app.log`, so messages go to the console and a file. */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "./utils/data-dir.js";
const MAX_LOG_BYTES = 1_000_000;
let fileFailureReported = false;
function logFile() {
    const configured = process.env.FREE_PI_LOG_FILE?.trim();
    return configured || join(dataDir(), "plugin.log");
}
function rotate(file) {
    try {
        if (statSync(file).size < MAX_LOG_BYTES)
            return;
        renameSync(file, `${file}.1`);
    }
    catch {
        // Missing file: nothing to rotate.
    }
}
function formatExtra(extra) {
    if (extra === undefined)
        return "";
    try {
        return ` ${JSON.stringify(extra)}`;
    }
    catch {
        return " [unserializable]";
    }
}
function appendToFile(line) {
    try {
        const file = logFile();
        mkdirSync(dirname(file), { recursive: true });
        rotate(file);
        appendFileSync(file, `${line}\n`, "utf8");
    }
    catch (error) {
        if (fileFailureReported)
            return;
        fileFailureReported = true;
        console.warn("[free-pi] could not write the plugin log file", error);
    }
}
export function createLogger(scope = "free-pi") {
    const write = (level, message, extra) => {
        const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}${formatExtra(extra)}`;
        if (level === "error")
            console.error(line);
        else if (level === "warn")
            console.warn(line);
        else
            console.log(line);
        appendToFile(line);
    };
    return {
        log: write,
        info: (message, extra) => write("info", message, extra),
        warn: (message, extra) => write("warn", message, extra),
        error: (message, extra) => write("error", message, extra),
    };
}
