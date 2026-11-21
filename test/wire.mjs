import assert from "node:assert/strict";

const { createRuntimeState } = await import("../dist/state.js");
const {
  forgetWireSessionID,
  hydrateWireSessionID,
  rotateWireSessionID,
  wireSessionID,
} = await import("../dist/session/wire.js");

const kv = new Map();
const storage = {
  get: async (key) => kv.get(key),
  set: async (key, value) => {
    kv.set(key, value);
  },
  remove: async (key) => {
    kv.delete(key);
  },
};

const log = { log() {}, info() {}, warn() {}, error() {} };
const makeDeps = () => ({
  state: createRuntimeState(),
  log,
  activeCredential: async () => undefined,
  readContext: async () => [],
  storage,
});

const first = makeDeps();
const rotated = rotateWireSessionID(first, "ses_resume");
assert.match(rotated, /^ses_resume-r[a-z0-9]{8}$/);
assert.equal(kv.get("wire-session/ses_resume"), rotated);

// A fresh plugin process (new state, same storage) reconnects the provider
// session instead of generating a different id.
const restarted = makeDeps();
assert.equal(wireSessionID(restarted, "ses_resume"), "ses_resume");
await hydrateWireSessionID(restarted, "ses_resume");
assert.equal(wireSessionID(restarted, "ses_resume"), rotated);

// A session with no saved id keeps the OpenCode id until the first rotation.
const unknown = makeDeps();
await hydrateWireSessionID(unknown, "ses_new");
assert.equal(wireSessionID(unknown, "ses_new"), "ses_new");
assert.equal(kv.has("wire-session/ses_new"), false);

// Deleting the OpenCode session releases the saved provider session.
forgetWireSessionID(restarted, "ses_resume");
assert.equal(kv.has("wire-session/ses_resume"), false);
assert.equal(wireSessionID(restarted, "ses_resume"), "ses_resume");

// A provider hit can force a new id even for a known session.
restarted.state.dirtySessions.add("ses_resume");
const next = rotateWireSessionID(restarted, "ses_resume");
assert.notEqual(next, rotated);
assert.equal(kv.get("wire-session/ses_resume"), next);

// Without storage the mapping still works in memory.
const memoryOnly = makeDeps();
delete memoryOnly.storage;
await hydrateWireSessionID(memoryOnly, "ses_memory");
const inMemory = rotateWireSessionID(memoryOnly, "ses_memory");
assert.equal(wireSessionID(memoryOnly, "ses_memory"), inMemory);

console.log("wire ok");
