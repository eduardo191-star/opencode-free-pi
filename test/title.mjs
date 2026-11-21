import assert from "node:assert/strict";

const { localTitle } = await import("../dist/session/title.js");

const user = (text) => ({
  role: "user",
  content: [{ type: "text", text }],
});

const messagePrompt = (text) =>
  `Here is the first message of the conversation:\n\n<message>\n${text}\n</message>\n\nReply with only the title.`;

// The title comes from the first message, not from the framing prompt.
assert.equal(
  localTitle([user(messagePrompt("Fix the login redirect bug in auth.ts"))]),
  "Fix the login redirect bug in auth.ts",
);

// Markdown markers and blank lines are stripped.
assert.equal(
  localTitle([user(messagePrompt("# Refactor the cache layer\n\nDetails here."))]),
  "Refactor the cache layer",
);
assert.equal(
  localTitle([user(messagePrompt("- add tests for the registry\n- keep retries"))]),
  "add tests for the registry",
);

// Regenerating a title from a conversation keeps the original request.
assert.equal(
  localTitle([
    user(
      `Here is the conversation so far:\n\n<conversation>\nOriginal request:\nAdd a quota panel\n\nRecent conversation:\nUser: and a chart\nAssistant: sure\n</conversation>\n\nReply with only the title.`,
    ),
  ]),
  "Add a quota panel",
);

// Code fences and bare XML tags are skipped.
assert.equal(
  localTitle([user(messagePrompt("```\n# Implement streaming\n```"))]),
  "Implement streaming",
);

// Long titles are shortened at a word boundary.
const long = localTitle([
  user(
    messagePrompt(
      "Explain why the session title generator keeps loading forever in OpenCode",
    ),
  ),
]);
assert.ok(long.length <= 60, long);
assert.ok(long.endsWith("..."), long);

// Nothing usable still produces a real title so the session leaves "New session".
assert.equal(localTitle(undefined), "Session");
assert.equal(localTitle([user(messagePrompt(""))]), "Session");
assert.equal(localTitle([user(messagePrompt("---"))]), "Session");

console.log("ok");
