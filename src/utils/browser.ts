/** Browser availability and opening links on every supported platform. */

import { spawn } from "node:child_process";
import { safeUrl } from "./urls.js";

export function browserAvailable(): boolean {
  if (
    process.env.FREEPI_DEVICE_LOGIN === "1" ||
    process.env.FREEPI_DEVICE_LOGIN === "true"
  ) {
    return false;
  }
  if (process.env.OPENCODE_HEADLESS) return false;
  if (
    process.env.SSH_CONNECTION ||
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY
  )
    return false;
  if (process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux"))
    return true;
  if (
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY
  ) {
    return false;
  }
  return true;
}

export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const target = safeUrl(url);
    if (!target) return resolve(false);
    const command =
      process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux")
        ? "termux-open-url"
        : process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "cmd"
            : "xdg-open";
    const args = command === "cmd" ? ["/c", "start", "", target] : [target];
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      child.once("error", () => finish(false));
      child.once("spawn", () => setTimeout(() => finish(true), 2_000));
      child.once("exit", (code) => finish(code === 0));
      child.unref();
    } catch {
      resolve(false);
    }
  });
}
