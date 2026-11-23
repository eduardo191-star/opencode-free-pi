import assert from "node:assert/strict";

import { pruneStaleToolResults } from "../dist/session/diet.js";
import { estimateMessageTokens } from "../dist/session/overflow.js";

const estimate = estimateMessageTokens;
const stubbed = (text) =>
  text.includes("characters of this tool result were pruned");

// A request that already fits is returned untouched.
{
  const messages = [
    { role: "user", content: "hola" },
    { role: "tool", tool_call_id: "t1", content: "salida corta" },
  ];
  const result = pruneStaleToolResults(messages, 10_000, estimate);
  assert.equal(result.pruned, 0);
  assert.equal(result.messages, messages);
  assert.equal(result.tokensBefore, result.tokensAfter);
}

// Over budget, the oldest tool results are collapsed and everything the model
// must follow stays verbatim: user wording, assistant decisions and the newest
// messages.
{
  const big = "x".repeat(40_000);
  const messages = [
    { role: "user", content: "arregla el parser" },
    { role: "tool", tool_call_id: "t1", content: `${big}HEAD${big}TAIL` },
    { role: "assistant", content: [{ type: "text", text: "confirmado el bug" }] },
    { role: "tool", tool_call_id: "t2", content: big },
    { role: "user", content: "sigue con el fix" },
  ];
  const result = pruneStaleToolResults(messages, 8_000, estimate);
  assert.equal(result.pruned, 2, String(result.pruned));
  assert.ok(result.tokensAfter < result.tokensBefore);
  assert.equal(result.messages.length, messages.length);
  assert.deepEqual(result.messages[0], messages[0]);
  assert.deepEqual(result.messages[2], messages[2]);
  assert.deepEqual(result.messages[4], messages[4]);
  assert.ok(stubbed(result.messages[1].content));
  assert.ok(result.messages[1].content.startsWith("x".repeat(600)));
  assert.ok(result.messages[1].content.endsWith("TAIL"));

  // The pruned text is deterministic: the next request prunes it the same way,
  // so the provider-side prefix stays stable.
  const again = pruneStaleToolResults(result.messages, 8_000, estimate);
  assert.equal(again.pruned, 0);
  assert.equal(again.messages, result.messages);
}

// The newest messages are protected even when the request is still over budget
// after pruning the stale ones.
{
  const big = "y".repeat(40_000);
  const messages = [
    { role: "tool", tool_call_id: "t1", content: big },
    { role: "tool", tool_call_id: "t2", content: big },
    { role: "tool", tool_call_id: "t3", content: big },
  ];
  const result = pruneStaleToolResults(messages, 10_000, estimate);
  assert.equal(result.pruned, 2);
  assert.deepEqual(result.messages[2], messages[2], "newest result untouched");
}

// Non-text payloads (images) and small results are left alone.
{
  const messages = [
    { role: "tool", tool_call_id: "t1", content: [{ type: "image", url: "x" }] },
    { role: "tool", tool_call_id: "t2", content: "corta" },
    { role: "user", content: "z".repeat(80_000) },
  ];
  const result = pruneStaleToolResults(messages, 4_000, estimate);
  assert.equal(result.pruned, 0);
  assert.equal(result.messages, messages);
}

// The native shape (assistant parts with state.content) is pruned too, keeping
// the tool name and its input.
{
  const big = "z".repeat(40_000);
  const messages = [
    {
      role: "assistant",
      content: [
        {
          type: "tool",
          name: "read",
          state: {
            status: "completed",
            input: { path: "C:\\src\\parser.c" },
            content: [{ type: "text", text: big }],
          },
        },
      ],
    },
    { role: "user", content: "continúa" },
  ];
  const result = pruneStaleToolResults(messages, 2_000, estimate);
  assert.equal(result.pruned, 1);
  const part = result.messages[0].content[0];
  assert.equal(part.name, "read");
  assert.deepEqual(part.state.input, { path: "C:\\src\\parser.c" });
  assert.ok(stubbed(part.state.content[0].text));
}

console.log("diet: ok");
