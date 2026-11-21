#!/usr/bin/env bash
set -euo pipefail

PACKAGE="@eduardo191labs/opencode-free-pi"
PLUGIN_NAME="opencode-free-pi"

say() {
	printf '%s\n' "$*"
}

fail() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

config_dir="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"

ensure_config() {
	mkdir -p "$config_dir"
	node - "$config_dir" "$PACKAGE" <<'NODE'
const { existsSync } = require("node:fs");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const dir = process.argv[2];
const pkg = process.argv[3];
const names = ["opencode.json", "opencode.jsonc", "opencode.json5"];
let file;
for (const name of names) {
  const candidate = join(dir, name);
  if (!existsSync(candidate)) continue;
  file = candidate;
  break;
}
if (!file) file = join(dir, "opencode.json");

let config = { $schema: "https://opencode.ai/config.json" };
if (existsSync(file)) {
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.log(`free-pi: no se pudo editar ${file} automáticamente.`);
    console.log(`free-pi: añade "${pkg}" a "plugins".`);
    process.exit(0);
  }
}

const plugins = Array.isArray(config.plugins) ? config.plugins : [];
const present = plugins.some((entry) => {
  if (typeof entry === "string") return entry === pkg || entry.startsWith(`${pkg}@`);
  return entry && entry.package === pkg;
});
if (!present) {
  plugins.push(pkg);
  config.plugins = plugins;
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`free-pi: registrado en ${file}.`);
} else {
  console.log(`free-pi: ya estaba registrado en ${file}.`);
}
NODE
}

remove_config() {
	node - "$config_dir" "$PACKAGE" <<'NODE'
const { existsSync } = require("node:fs");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const dir = process.argv[2];
const pkg = process.argv[3];
for (const name of ["opencode.json", "opencode.jsonc", "opencode.json5"]) {
  const file = join(dir, name);
  if (!existsSync(file)) continue;
  try {
    const config = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(config.plugins)) continue;
    const next = config.plugins.filter((entry) => {
      if (typeof entry === "string") {
        return !(entry === pkg || entry.startsWith(`${pkg}@`));
      }
      return !entry || entry.package !== pkg;
    });
    if (next.length === config.plugins.length) continue;
    config.plugins = next;
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`free-pi: eliminado de ${file}.`);
  } catch {
    console.log(`free-pi: edita ${file} y quita "${pkg}" de "plugins".`);
  }
  break;
}
NODE
}

uninstall() {
	remove_config
	rm -f "$config_dir/plugins/${PLUGIN_NAME}.ts" "$config_dir/plugins/${PLUGIN_NAME}.js"
	npm uninstall -g "$PACKAGE" >/dev/null 2>&1 || true
	say "Removed ${PACKAGE}."
	say "Restart OpenCode to finish."
}

if [ "${1:-}" = "--uninstall" ]; then
	uninstall
	exit 0
fi

command -v node >/dev/null 2>&1 || fail "Node.js 20+ is required"
command -v npm >/dev/null 2>&1 || fail "npm is required"

say "Installing ${PACKAGE}..."
npm install -g "${PACKAGE}@latest"

if command -v opencode >/dev/null 2>&1; then
	if opencode plugin add "${PACKAGE}@latest" >/dev/null 2>&1; then
		say "Registered with opencode plugin add."
	elif opencode plugin --global "${PACKAGE}@latest" >/dev/null 2>&1; then
		say "Registered with opencode plugin --global."
	fi
fi

ensure_config

say ""
say "Next steps:"
say "  1. Run: opencode auth login free-pi"
say "  2. Restart OpenCode (or run /reload)."
say ""
say "Credentials: ${FREEPI_CREDENTIALS_PATH:-~/.free-pi/agent/credentials.json}"
