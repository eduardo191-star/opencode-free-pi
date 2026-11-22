import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  FREE_PI_AGENT_IDS,
  FREE_PI_SKILL,
  freePiAgentPath,
  installFreePiAgents,
} = await import("../dist/agents/definitions.js");

const dir = await mkdtemp(join(tmpdir(), "freepi-agents-"));
try {
  const first = await installFreePiAgents(dir);
  assert.deepEqual(first.installed, [...FREE_PI_AGENT_IDS]);
  assert.deepEqual(first.skipped, []);
  assert.equal(first.changed, true);

  const scoutPath = freePiAgentPath(dir, "free-pi/scout");
  assert.match(scoutPath.replaceAll("\\", "/"), /\/agents\/free-pi\/scout\.md$/);
  const scout = await readFile(scoutPath, "utf8");
  assert.match(scout, /^---\n/);
  assert.match(scout, /^<!-- managed by @eduardo191labs\/opencode-free-pi/m);
  assert.match(scout, /^mode: all$/m);
  assert.match(scout, /Read-only recon/);
  assert.match(scout, /## Files Retrieved/);
  assert.match(scout, /action: edit/);

  const reviewer = await readFile(freePiAgentPath(dir, "free-pi/reviewer"), "utf8");
  assert.match(reviewer, /git diff/);
  assert.match(reviewer, /## Critical \(must fix\)/);

  const worker = await readFile(freePiAgentPath(dir, "free-pi/worker"), "utf8");
  assert.match(worker, /isolated context/);
  assert.doesNotMatch(worker, /action: edit\n    resource: "\*"\n    effect: deny/);

  // A second pass is a no-op.
  const again = await installFreePiAgents(dir);
  assert.equal(again.changed, false);
  assert.deepEqual(again.installed, []);

  // User-owned files are never overwritten.
  const custom = freePiAgentPath(dir, "free-pi/planner");
  await writeFile(custom, "---\nmode: subagent\n---\nmy own planner\n", "utf8");
  const third = await installFreePiAgents(dir);
  assert.deepEqual(third.skipped, ["free-pi/planner"]);
  assert.equal(await readFile(custom, "utf8"), "---\nmode: subagent\n---\nmy own planner\n");

  // A missing directory is created as needed.
  await rm(join(dir, "agents"), { recursive: true });
  await mkdir(dir, { recursive: true });
  const rebuilt = await installFreePiAgents(dir);
  assert.deepEqual(rebuilt.installed, [...FREE_PI_AGENT_IDS]);

  // The skill points at OpenCode's native session and memory mechanisms.
  assert.match(FREE_PI_SKILL, /AGENTS\.md/);
  assert.match(FREE_PI_SKILL, /compaction/);
  assert.match(FREE_PI_SKILL, /free-pi\/scout/);
  assert.doesNotMatch(FREE_PI_SKILL, /remember/);
  assert.doesNotMatch(FREE_PI_SKILL, /free_pi_buy_credits/);
  assert.doesNotMatch(FREE_PI_SKILL, /fusion/i);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("agents ok");
