/** Logging for the plugin. V2 has no `app.log`, so messages go to the console. */
export function createLogger(scope = "free-pi") {
    const write = (level, message, extra) => {
        const line = `[${scope}] ${message}`;
        const args = extra === undefined ? [line] : [line, extra];
        if (level === "error")
            console.error(...args);
        else if (level === "warn")
            console.warn(...args);
        else
            console.log(...args);
    };
    return {
        log: write,
        info: (message, extra) => write("info", message, extra),
        warn: (message, extra) => write("warn", message, extra),
        error: (message, extra) => write("error", message, extra),
    };
}
