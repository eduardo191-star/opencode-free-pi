import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  applyEnvironmentProxy,
  proxyFromEnvironment,
} from "../dist/network/proxy.js";

// --- proxy discovery -------------------------------------------------------
assert.equal(proxyFromEnvironment({}), undefined);
assert.equal(proxyFromEnvironment({ HTTPS_PROXY: "  " }), undefined);
assert.equal(
  proxyFromEnvironment({ HTTPS_PROXY: "http://vpn:8080" }),
  "http://vpn:8080",
);
assert.equal(
  proxyFromEnvironment({ https_proxy: "http://lower:3128" }),
  "http://lower:3128",
);
assert.equal(
  proxyFromEnvironment({
    ALL_PROXY: "socks5://all:1080",
    HTTP_PROXY: "http://plain:80",
  }),
  "http://plain:80",
  "HTTPS/HTTP win over ALL_PROXY",
);
assert.equal(
  proxyFromEnvironment({ https_proxy: "http://lower:3128", ALL_PROXY: "socks5://x" }),
  "http://lower:3128",
  "lowercase https_proxy is honored",
);

// --- no proxy configured: nothing changes --------------------------------
const messages = [];
const fakeLog = {
  log: () => {},
  info: (message) => messages.push(["info", message]),
  warn: (message) => messages.push(["warn", message]),
  error: () => {},
};
const saved = {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  https_proxy: process.env.https_proxy,
  HTTP_PROXY: process.env.HTTP_PROXY,
  http_proxy: process.env.http_proxy,
  ALL_PROXY: process.env.ALL_PROXY,
  all_proxy: process.env.all_proxy,
};
for (const name of Object.keys(saved)) delete process.env[name];
assert.equal(applyEnvironmentProxy(fakeLog), false);
assert.deepEqual(messages, [], "no proxy in the environment stays silent");
for (const [name, value] of Object.entries(saved)) {
  if (typeof value === "string") process.env[name] = value;
  else delete process.env[name];
}

const canApplyProxy = typeof http.setGlobalProxyFromEnv === "function";

// `ALL_PROXY` is the generic name VPN clients export; Node ignores it, so the
// plugin copies it into the protocol-specific variables it does read.
const allEnv = { ALL_PROXY: "http://all:3128" };
assert.equal(applyEnvironmentProxy(fakeLog, allEnv), canApplyProxy);
assert.equal(allEnv.HTTPS_PROXY, "http://all:3128");
assert.equal(allEnv.HTTP_PROXY, "http://all:3128");

// A SOCKS URL cannot be dialed by Node's env proxy support: warn, stay direct.
messages.length = 0;
const socksEnv = { ALL_PROXY: "socks5://all:1080" };
assert.equal(applyEnvironmentProxy(fakeLog, socksEnv), false);
assert.equal(messages.length, 1);
assert.equal(messages[0][0], "warn");
assert.match(messages[0][1], /only http\/https proxies/);

// --- a configured proxy is actually used by fetch -------------------------
// Node 24.5+ is the first runtime with `http.setGlobalProxyFromEnv()`; older
// releases ignore `*_proxy` in `fetch` no matter what, so there the plugin must
// warn with an actionable message instead of silently going direct.
if (!canApplyProxy) {
  process.env.HTTPS_PROXY = "http://127.0.0.1:9";
  messages.length = 0;
  assert.equal(applyEnvironmentProxy(fakeLog), false);
  delete process.env.HTTPS_PROXY;
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], "warn");
  assert.match(messages[0][1], /NODE_USE_ENV_PROXY=1/);
  console.log("network ok (runtime without setGlobalProxyFromEnv)");
  process.exit(0);
}

const seen = [];
const proxy = http.createServer((req, res) => {
  seen.push(req.url);
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("proxied");
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const port = proxy.address().port;

const childCode = `
import path from "node:path";
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(path.join(process.cwd(), "dist/network/proxy.js")).href);
const log = { log(){}, info(){}, warn(){}, error(){} };
const applied = mod.applyEnvironmentProxy(log);
const response = await fetch("http://free-pi.invalid/probe");
const body = await response.text();
console.log(JSON.stringify({ applied, body }));
`;
const child = await new Promise((resolve, reject) => {
  const proc = spawn(
    process.execPath,
    ["--input-type=module", "-e", childCode],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        HTTPS_PROXY: `http://127.0.0.1:${port}`,
        HTTP_PROXY: `http://127.0.0.1:${port}`,
        NO_PROXY: "",
        no_proxy: "",
      },
    },
  );
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk) => (stdout += chunk));
  proc.stderr.on("data", (chunk) => (stderr += chunk));
  const timer = setTimeout(() => proc.kill(), 30_000);
  proc.on("error", reject);
  proc.on("close", (code) => {
    clearTimeout(timer);
    if (code !== 0) reject(new Error(`child failed (${code}): ${stderr}`));
    else resolve(stdout.trim());
  });
});

proxy.close();
const result = JSON.parse(child.split("\n").at(-1));
assert.equal(result.applied, true, "the plugin enabled the environment proxy");
assert.equal(result.body, "proxied", "fetch went through the proxy");
assert.deepEqual(seen, ["http://free-pi.invalid/probe"]);

console.log("network ok");
