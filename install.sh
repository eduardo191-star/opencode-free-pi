#!/usr/bin/env bash
set -euo pipefail

REPO="${FREEPI_OPENCODE_REPO:-eduardo191-star/opencode-free-pi}"
REF="${FREEPI_OPENCODE_REF:-main}"
RAW_BASE="${FREEPI_OPENCODE_RAW_BASE:-https://raw.githubusercontent.com/${REPO}/${REF}}"
PLUGIN_NAME="opencode-free-pi"

say() {
	printf '%s\n' "$*"
}

fail() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

uninstall() {
	local config_dir="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
	local plugin_dir="${config_dir}/plugins"
	rm -f "${plugin_dir}/${PLUGIN_NAME}.ts" "${plugin_dir}/${PLUGIN_NAME}.js"
	say "Removed ${PLUGIN_NAME} from ${plugin_dir}"
	say "Restart OpenCode to finish."
}

if [ "${1:-}" = "--uninstall" ]; then
	uninstall
	exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl is required"
[ -n "${HOME:-}" ] || fail "HOME is not set"

config_dir="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
plugin_dir="${config_dir}/plugins"
target="${plugin_dir}/${PLUGIN_NAME}.ts"
tmp="$(mktemp "${TMPDIR:-/tmp}/${PLUGIN_NAME}.XXXXXX")"
cleanup() {
	rm -f "$tmp"
}
trap cleanup EXIT

script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
	script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "$script_dir" ] && [ -f "${script_dir}/dist/index.js" ]; then
	cp "${script_dir}/dist/index.js" "$tmp"
	say "Using local build: ${script_dir}/dist/index.js"
else
	say "Downloading ${RAW_BASE}/dist/index.js"
	curl -fsSL --retry 3 --retry-delay 1 "${RAW_BASE}/dist/index.js" -o "$tmp"
fi

[ -s "$tmp" ] || fail "downloaded plugin is empty"
grep -q "FreePiPlugin" "$tmp" || fail "downloaded file does not look like the free-pi plugin"

mkdir -p "$plugin_dir"
if [ -f "$target" ]; then
	cp "$target" "${target}.bak"
fi
mv "$tmp" "$target"
rm -f "${plugin_dir}/${PLUGIN_NAME}.js"

say "Installed ${PLUGIN_NAME} at ${target}"
say ""
say "Next steps:"
say "  1. Run: opencode auth login -p free-pi"
say "  2. Restart OpenCode."
say ""
say "Credentials: ${FREEPI_CREDENTIALS_PATH:-~/.free-pi/agent/credentials.json}"
