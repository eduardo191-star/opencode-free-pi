import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(packageRoot, "dist", "index.js");
const isGlobal = process.env.npm_config_global === "true";

if (!isGlobal && process.env.FREEPI_CONFIGURE !== "1") {
  console.log(
    "free-pi: instalación local; usa `npm i -g` o FREEPI_CONFIGURE=1 para registrar el plugin.",
  );
  process.exit(0);
}

if (!existsSync(source)) {
  console.error(`free-pi: no se encontró ${source}`);
  process.exit(1);
}

const configDir =
  process.env.OPENCODE_CONFIG_DIR ||
  (process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "opencode")
    : join(homedir(), ".config", "opencode"));
const pluginDir = join(configDir, "plugins");
const target = join(pluginDir, "opencode-free-pi.ts");

function display(file) {
  const home = homedir();
  if (process.platform === "win32") return file.replace(home, "%USERPROFILE%");
  return file.replace(home, "~");
}

const configNames = ["opencode.json", "opencode.jsonc", "opencode.json5"];
let configured = false;
for (const name of configNames) {
  const file = join(configDir, name);
  if (!existsSync(file)) continue;
  try {
    const text = await readFile(file, "utf8");
    configured = /@eduardo191labs\/opencode-free-pi/.test(text);
  } catch {}
  if (configured) break;
}

if (configured) {
  await rm(target, { force: true });
  console.log(
    "free-pi: el paquete ya está configurado en OpenCode; se omitió el plugin local.",
  );
  console.log("free-pi: reinicia OpenCode y ejecuta `opencode plugin list`.");
  process.exit(0);
}

await mkdir(pluginDir, { recursive: true });
await copyFile(source, target);

console.log(`free-pi: plugin instalado en ${display(target)}`);
console.log(
  "free-pi: reinicia OpenCode y ejecuta `opencode auth login -p free-pi`.",
);
