/** Logging for the plugin. V2 has no `app.log`, so messages go to the console. */

export type LogLevel = "info" | "warn" | "error" | "debug";

export type Logger = {
  log: (level: LogLevel, message: string, extra?: unknown) => void;
  info: (message: string, extra?: unknown) => void;
  warn: (message: string, extra?: unknown) => void;
  error: (message: string, extra?: unknown) => void;
};

export function createLogger(scope = "free-pi"): Logger {
  const write = (level: LogLevel, message: string, extra?: unknown) => {
    const line = `[${scope}] ${message}`;
    const args = extra === undefined ? [line] : [line, extra];
    if (level === "error") console.error(...args);
    else if (level === "warn") console.warn(...args);
    else console.log(...args);
  };
  return {
    log: write,
    info: (message, extra) => write("info", message, extra),
    warn: (message, extra) => write("warn", message, extra),
    error: (message, extra) => write("error", message, extra),
  };
}
