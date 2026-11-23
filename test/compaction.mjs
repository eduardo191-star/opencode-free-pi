import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "freepi-compaction-"));
process.env.FREE_PI_DATA_DIR = dir;
process.env.FREEPI_CREDENTIALS_PATH = join(dir, "missing-credentials.json");
process.env.FREEPI_BASE_URL = "https://api.test";
delete process.env.FREEPI_JWT;

const { buildRecentWindow, recentWindowGuidance } = await import(
  "../dist/session/recent.js"
);
const { RECENT_WINDOW_CHARS, RECENT_WINDOW_MARKER } = await import(
  "../dist/constants.js"
);

const user = (text) => ({
  id: `u_${text.length}_${Math.random().toString(36).slice(2, 8)}`,
  type: "user",
  role: "user",
  text,
  content: [{ type: "text", text }],
});

const assistant = (text, tools = []) => ({
  id: `a_${Math.random().toString(36).slice(2, 8)}`,
  type: "assistant",
  role: "assistant",
  content: [
    ...(text ? [{ type: "text", text }] : []),
    ...tools.map(([name, input, result]) => ({
      type: "tool",
      name,
      state: {
        status: "completed",
        input,
        content: [{ type: "text", text: result }],
      },
    })),
  ],
});

try {
  // Nothing to quote: no session, no messages.
  assert.equal(buildRecentWindow([]), undefined, "empty history is skipped");
  assert.equal(
    buildRecentWindow([{ id: "x", type: "idle" }]),
    undefined,
    "a history without text or tools is skipped",
  );

  // The newest work survives, the oldest turns fall out of the budget.
  {
    const filler = "x".repeat(4_000);
    const history = [
      user(`old request ${filler}`),
      assistant(`old answer ${filler}`),
      user("recent request: la compresión olvida lo reciente"),
      assistant("", [
        [
          "edit",
          { path: "src/session/hooks.ts" },
          "Edited src/session/hooks.ts (1 replacement)",
        ],
      ]),
    ];
    const window = buildRecentWindow(history, 6_000);
    assert.ok(window, "a window is built");
    assert.match(window.text, /recent request: la compresión olvida lo reciente/);
    assert.match(window.text, /Edited src\/session\/hooks\.ts/);
    assert.doesNotMatch(window.text, /old request/);
    assert.equal(window.truncated, true);
    assert.ok(window.messages >= 2, String(window.messages));

    const guidance = recentWindowGuidance(window);
    assert.ok(guidance.startsWith(RECENT_WINDOW_MARKER));
    assert.match(guidance, /## Recent window/);
    assert.match(guidance, /Edited src\/session\/hooks\.ts/);
  }

  // The default budget is respected even with far more history than it holds.
  {
    const history = [];
    for (let index = 0; index < 300; index += 1) {
      history.push(user(`turn ${index} ${"y".repeat(1_000)}`));
      history.push(assistant(`answer ${index} ${"z".repeat(1_000)}`));
    }
    const window = buildRecentWindow(history);
    assert.ok(window);
    assert.ok(
      window.text.length <= RECENT_WINDOW_CHARS + 400,
      `${window.text.length} > ${RECENT_WINDOW_CHARS}`,
    );
    assert.match(window.text, /turn 299/);
    assert.equal(window.truncated, true);
  }

  // A short session is quoted whole, so a compaction early in the work keeps it.
  {
    const history = [
      user("primera petición"),
      assistant("primera respuesta"),
      user("segunda petición"),
    ];
    const window = buildRecentWindow(history);
    assert.ok(window);
    assert.equal(window.truncated, false);
    assert.match(window.text, /primera petición/);
    assert.match(window.text, /segunda petición/);
  }

  console.log("compaction ok");
} finally {
  await rm(dir, { recursive: true, force: true });
}
