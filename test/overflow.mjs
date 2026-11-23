import assert from "node:assert/strict";

const { createRuntimeState } = await import("../dist/state.js");
const { noteSpuriousOverflow } = await import("../dist/session/overflow.js");

const deps = { state: createRuntimeState() };

// A repeated rejection of a session that fits accumulates instead of resetting.
noteSpuriousOverflow(deps, "ses_touched");
noteSpuriousOverflow(deps, "ses_touched");
assert.equal(deps.state.spuriousOverflows.get("ses_touched")?.count, 2);

// Retouching an existing session must move it to the end of the insertion
// order. Otherwise the bounded trim evicts a session that is still rejecting
// and its storm counter restarts, letting compaction loop again.
for (let index = 0; index < 511; index += 1) {
  noteSpuriousOverflow(deps, `ses_fill_${index}`);
}
const size = deps.state.spuriousOverflows.size;
assert.equal(size, 512, "the set holds its 512-session limit");

noteSpuriousOverflow(deps, "ses_touched");
assert.equal(
  deps.state.spuriousOverflows.size,
  512,
  "retouching an existing session does not grow the map",
);

noteSpuriousOverflow(deps, "ses_new");
assert.equal(deps.state.spuriousOverflows.size, 512, "the trim keeps the cap");
assert.equal(
  deps.state.spuriousOverflows.has("ses_touched"),
  true,
  "the retouched session is not the one evicted",
);
assert.equal(
  deps.state.spuriousOverflows.has("ses_fill_0"),
  false,
  "the oldest untouched session is the one evicted",
);

console.log("overflow ok");
