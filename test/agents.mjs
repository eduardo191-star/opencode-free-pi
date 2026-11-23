import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  FREE_PI_AGENT_IDS,
  FREE_PI_SKILL,
  FREE_PI_SKILL_FILE,
  freePiAgentPath,
  freePiSkillPath,
  installFreePiAgents,
  installFreePiSkill,
} = await import("../dist/agents/definitions.js");
const { FREE_PI_GUIDANCE } = await import("../dist/constants.js");

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

  // The skill is a native SKILL.md so OpenCode's loader owns its ID, path and
  // permissions. It is installed once and then left alone.
  const skillPath = freePiSkillPath(dir);
  assert.match(skillPath.replaceAll("\\", "/"), /\/skills\/free-pi\/SKILL\.md$/);
  const skillFirst = await installFreePiSkill(dir);
  assert.equal(skillFirst.changed, true);
  const skillFile = await readFile(skillPath, "utf8");
  assert.equal(skillFile, FREE_PI_SKILL_FILE);
  assert.match(skillFile, /^---\nname: free-pi\ndescription: /);
  assert.match(skillFile, /managed by @eduardo191labs\/opencode-free-pi/);
  assert.match(skillFile, /free-pi\/scout/);
  assert.doesNotMatch(skillFile, /remember/);
  const skillAgain = await installFreePiSkill(dir);
  assert.equal(skillAgain.changed, false);
  assert.equal(skillAgain.installed, false);

  // A user-owned skill file is never overwritten.
  await writeFile(skillPath, "---\nname: mine\n---\nmy own skill\n", "utf8");
  const skillProtected = await installFreePiSkill(dir);
  assert.equal(skillProtected.skipped, true);
  assert.equal(skillProtected.changed, false);
  assert.equal(await readFile(skillPath, "utf8"), "---\nname: mine\n---\nmy own skill\n");

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

  // The per-request guidance points every free-pi model at OpenCode's native
  // delegation, skills and project instructions.
  assert.match(FREE_PI_GUIDANCE, /subagent/);
  assert.match(FREE_PI_GUIDANCE, /free-pi\/scout/);
  assert.match(FREE_PI_GUIDANCE, /free-pi\/worker/);
  assert.match(FREE_PI_GUIDANCE, /skill/);
  assert.match(FREE_PI_GUIDANCE, /AGENTS\.md/);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("agents ok");
