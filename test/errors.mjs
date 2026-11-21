import assert from "node:assert/strict";

const { parseFreePiError, parseRawFreePiError } = await import(
  "../dist/errors/parse.js"
);
const { friendlyFreePiError } = await import("../dist/errors/messages.js");
const { rewriteLimitResponse } = await import("../dist/errors/limit.js");

// The free-usage-limit 429 sends a message but no `code` field; the parser
// recovers the code from the text instead of logging `unknown`.
const freeLimit = parseFreePiError({
  status: 429,
  data: {
    message:
      "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go",
  },
});
assert.equal(freeLimit?.code, "free_usage_limit");
assert.equal(freeLimit?.status, 429);
// The server's own message stays the friendly text.
assert.match(friendlyFreePiError(freeLimit), /Free usage limit reached/);

// A code-less overflow message classifies as context overflow.
const overflow = parseFreePiError({
  status: 413,
  data: {
    message: "This conversation is too long. Run /compact or start a new session with /new.",
  },
});
assert.equal(overflow?.code, "context_too_long");

// An envelope with an explicit code keeps it.
const coded = parseFreePiError({
  status: 429,
  data: { code: "daily_cap", message: "used up" },
});
assert.equal(coded?.code, "daily_cap");

// Raw text errors classify too.
assert.equal(
  parseRawFreePiError({
    message: "Free usage limit reached. Free models work in OpenCode.",
    status: 429,
  })?.code,
  "free_usage_limit",
);

// The free-usage 429 is terminal: rewriting it to a 400 stops OpenCode from
// retrying it forever. A capacity 429 is transient and stays a 429.
const usageResponse = new Response(
  JSON.stringify({
    code: "free_usage_limit",
    message:
      "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go",
  }),
  { status: 429, headers: { "content-type": "application/json" } },
);
const rewrittenUsage = await rewriteLimitResponse(usageResponse);
assert.equal(rewrittenUsage?.status, 400);
assert.equal(
  rewrittenUsage.headers.get("x-free-pi-original-status"),
  "429",
);
assert.match(
  (await rewrittenUsage.json()).message,
  /Free usage limit reached/,
);

const capacityResponse = new Response(
  JSON.stringify({ code: "model_at_capacity", message: "model at capacity" }),
  { status: 429, headers: { "content-type": "application/json" } },
);
assert.equal(await rewriteLimitResponse(capacityResponse), undefined);

console.log("ok");
