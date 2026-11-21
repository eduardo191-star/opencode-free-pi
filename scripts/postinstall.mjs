/**
 * Registers the published package in the global OpenCode configuration.
 *
 * OpenCode V2 loads plugins from the `plugins` list in `opencode.json(c)`.
 * Copying the built file into a plugins directory does not work for this
 * package because it imports `@opencode/plugin` at runtime, so the package has
 * to stay resolvable from node_modules.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PACKAGE_NAME = "@eduardo191labs/opencode-free-pi";
const isGlobal = process.env.npm_config_global === "true";
const shouldConfigure = isGlobal || process.env.FREEPI_CONFIGURE === "1";

const configDir =
  process.env.OPENCODE_CONFIG_DIR ||
  (process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "opencode")
    : join(homedir(), ".config", "opencode"));

function display(file) {
  const home = homedir();
  if (process.platform === "win32") return file.replace(home, "%USERPROFILE%");
  return file.replace(home, "~");
}

async function removeLegacyCopy() {
  const legacy = join(configDir, "plugins", "opencode-free-pi.ts");
  if (!existsSync(legacy)) return;
  try {
    const text = await readFile(legacy, "utf8");
    if (text.includes("free-pi")) await rm(legacy, { force: true });
  } catch {}
}

if (!shouldConfigure) {
  console.log(
    `free-pi: instalación local. Añade "${PACKAGE_NAME}" a "plugins" en tu opencode.json.`,
  );
  process.exit(0);
}

await removeLegacyCopy();

const candidates = ["opencode.json", "opencode.jsonc", "opencode.json5"];
let configFile;
let config;

for (const name of candidates) {
  const file = join(configDir, name);
  if (!existsSync(file)) continue;
  configFile = file;
  try {
    config = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // Comments or JSON5 cannot be rewritten safely; report the manual step.
    config = undefined;
  }
  break;
}

if (configFile && !config) {
  console.log(
    `free-pi: no se pudo editar ${display(configFile)} automáticamente.`,
  );
  console.log(`free-pi: añade "${PACKAGE_NAME}" a "plugins".`);
  process.exit(0);
}

if (!config) {
  configFile = join(configDir, "opencode.json");
  config = { $schema: "https://opencode.ai/config.json" };
}

const plugins = Array.isArray(config.plugins) ? config.plugins : [];
const configured = plugins.some((entry) => {
  if (typeof entry === "string") {
    return entry === PACKAGE_NAME || entry.startsWith(`${PACKAGE_NAME}@`);
  }
  return entry?.package === PACKAGE_NAME;
});

if (!configured) {
  plugins.push(PACKAGE_NAME);
  config.plugins = plugins;
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`free-pi: registrado en ${display(configFile)}.`);
} else {
  console.log(`free-pi: ya estaba registrado en ${display(configFile)}.`);
}

console.log(
  "free-pi: ejecuta `opencode auth login -p free-pi` y luego /reload.",
);
