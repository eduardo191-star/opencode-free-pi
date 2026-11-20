import assert from "node:assert/strict";

const mod = await import("../dist/index.js");

assert.equal(typeof mod.FreePiPlugin, "function");
assert.equal(mod.default.id, "free-pi");
assert.equal(typeof mod.default.server, "function");

console.log("ok");
