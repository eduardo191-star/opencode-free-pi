/** Logging for the plugin. V2 has no `app.log`, so messages go to the console. */
export type LogLevel = "info" | "warn" | "error" | "debug";
export type Logger = {
    log: (level: LogLevel, message: string, extra?: unknown) => void;
    info: (message: string, extra?: unknown) => void;
    warn: (message: string, extra?: unknown) => void;
    error: (message: string, extra?: unknown) => void;
};
export declare function createLogger(scope?: string): Logger;
