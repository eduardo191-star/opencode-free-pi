import assert from "node:assert/strict";

const mod = await import("../dist/index.js");

assert.equal(typeof mod.FreePiPlugin, "object");
assert.equal(mod.default, mod.FreePiPlugin);
assert.equal(mod.default.id, "free-pi");
assert.equal(typeof mod.default.setup, "function");

console.log("ok");
