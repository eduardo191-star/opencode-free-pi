/**
 * Native OpenCode agents for free-pi.
 *
 * The provider CLI ships four agent personalities (scout, planner, worker,
 * reviewer) with their own prompts and tool access. OpenCode's V2 plugin API
 * cannot add agents through `AgentEditor`, but it loads Markdown agents from the
 * global config directory. Installing those files is the supported way to map
 * the CLI agents onto OpenCode's native `subagent` tool, so child sessions,
 * background reports, permissions and the agent picker keep working normally.
 *
 * They use `mode: all`: OpenCode only lists non-subagent agents in the `/agents`
 * picker, and only agents whose mode is not `primary` can run through the
 * `subagent` tool. `all` satisfies both, so the same personalities are
 * selectable as the main agent and spawnable as children.
 *
 * Files live under `agents/free-pi/`, which makes their IDs `free-pi/scout`,
 * `free-pi/planner`, `free-pi/worker` and `free-pi/reviewer`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const MARKER = "<!-- managed by @eduardo191labs/opencode-free-pi; delete this line to keep your own copy -->";
export const FREE_PI_AGENT_IDS = [
    "free-pi/scout",
    "free-pi/planner",
    "free-pi/worker",
    "free-pi/reviewer",
];
export const FREE_PI_SKILL_ID = "free-pi";
export const FREE_PI_SKILL_NAME = "free-pi";
export const FREE_PI_SKILL_DESCRIPTION = "How free-pi works in OpenCode: its tools, the installed native subagents, allowance and limits, and where sessions and memory live.";
export const FREE_PI_SKILL = `# free-pi in OpenCode

free-pi is a free, ad-supported provider for OpenCode. You sign in with GitHub
and ads in the session pay for the inference; there is no model API key. The
free daily allowance is shared by every free-pi model and every tool that spends
it.

## Tools
- \`free_pi_usage\` shows today's remaining allowance, credits, token counts and
  the account tier. Read-only.
- \`look_at_image\` asks a vision model about a PNG, JPEG or WebP inside the
  project. Use it when the current model takes text only, or when the image is a
  file on disk and you want a targeted answer instead of attaching it.
- \`generate_image\` draws one image from a prompt and saves it under \`images/\`.
- \`web_search\` searches the web for current information.
- \`docs_lookup\` looks up current library and framework documentation.

Every tool except \`free_pi_usage\` spends allowance. Usage limits
(\`daily_cap\`, \`rolling_cap\`, concurrency) are terminal: stop and continue
without the tool instead of retrying.

## Subagents

Use OpenCode's native subagent tool with the agents this plugin installs:

| Agent | Use it for |
| --- | --- |
| \`free-pi/scout\` | Read-only recon: locate code and return structured findings. |
| \`free-pi/planner\` | Read-only plan for a change, ready for a worker. |
| \`free-pi/worker\` | Carry out one full task in its own context window. |
| \`free-pi/reviewer\` | Read-only review with file and line references. |

Subagents inherit the free-pi model, share the same daily allowance, and run as
child sessions in the background. Keep large exploration in a subagent so it
does not fill your own context. Use OpenCode's agent picker or the \`subagent\`
tool; do not try to launch them through shell commands.

## Memory and sessions

OpenCode owns memory and context: \`AGENTS.md\` and configured instruction files
are loaded natively, sessions persist and resume, and compaction folds long
conversations into a summary. Put durable project facts in \`AGENTS.md\` (or a
file listed under \`instructions\`) instead of repeating them in every prompt.

## Native integrations

MCP servers, skills, commands, references and permissions are configured in
OpenCode as usual; free-pi does not replace them. Prefer those native features
over running an external CLI.
`;
const SCOUT = `---
description: Read-only recon. Locates code, traces how pieces connect, and returns structured findings the lead can use without re-reading the files.
mode: all
color: "#4cc9f0"
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
---

${MARKER}

You are a scout. Quickly investigate a codebase and return structured findings
that another agent can use without re-reading everything. Your output goes to an
agent who has NOT seen the files you explored.

Use read, grep and glob to locate relevant code; read key sections (not whole
files); note types, key functions, and how pieces connect. Do not modify files.

Output format:
## Files Retrieved
1. \`path/to/file.ts\` (lines 10-50) - what is here
## Key Code
The critical types, interfaces, or functions, quoted from the files.
## Architecture
How the pieces connect, briefly.
## Start Here
Which file to look at first and why.
`;
const PLANNER = `---
description: Turns context and requirements into a concrete implementation plan. Read-only: never edits files or runs commands.
mode: all
color: "#b5179e"
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
---

${MARKER}

You are a planning specialist. You receive context and requirements, then
produce a clear implementation plan. You must NOT make any changes. Only read,
analyze, and plan.

Output format:
## Goal
One sentence.
## Plan
Numbered steps, each small and actionable, naming the file or function to change.
## Files to Modify
## New Files (if any)
## Risks
Keep the plan concrete: a worker agent will execute it verbatim.
`;
const WORKER = `---
description: Full-capability worker that carries out one delegated task in its own context window and reports what changed.
mode: all
color: "#2a9d8f"
permissions:
  - action: subagent
    resource: "*"
    effect: deny
---

${MARKER}

You are a worker agent with full capabilities, working in an isolated context
window on a task delegated by the lead. Work autonomously to complete it.

Do not start other subagents.

Output format when finished:
## Completed
What was done.
## Files Changed
- \`path/to/file.ts\` - what changed
## Notes (if any)
Anything the lead should know.
`;
const REVIEWER = `---
description: Senior code reviewer for quality, security and maintainability. Read-only; reports findings with file and line references.
mode: all
color: "#e76f51"
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: shell
    resource: "git diff*"
    effect: allow
  - action: shell
    resource: "git log*"
    effect: allow
  - action: shell
    resource: "git show*"
    effect: allow
  - action: shell
    resource: "git status*"
    effect: allow
  - action: subagent
    resource: "*"
    effect: deny
---

${MARKER}

You are a senior code reviewer. Analyze code for quality, security, and
maintainability.

Bash is for read-only commands only: \`git diff\`, \`git log\`, \`git show\`.
Do NOT modify files or run builds. Assume tool permissions are not perfectly
enforceable; keep all bash usage strictly read-only.

Strategy: run \`git diff\` to see recent changes (if applicable), read the
modified files, check for bugs, security issues, and code smells.

Output format:
## Files Reviewed
## Critical (must fix)
- \`file.ts:42\` - issue
## Warnings (should fix)
## Suggestions (consider)
## Summary
Overall assessment in 2-3 sentences. Be specific with file paths and line
numbers.
`;
const AGENT_FILES = [
    { id: "free-pi/scout", content: SCOUT },
    { id: "free-pi/planner", content: PLANNER },
    { id: "free-pi/worker", content: WORKER },
    { id: "free-pi/reviewer", content: REVIEWER },
];
/** OpenCode's user-wide config directory, where it loads custom agents. */
export function openCodeConfigDir() {
    const explicit = process.env.OPENCODE_CONFIG_DIR?.trim();
    if (explicit)
        return explicit;
    const xdg = process.env.XDG_CONFIG_HOME?.trim();
    if (xdg)
        return join(xdg, "opencode");
    return join(homedir(), ".config", "opencode");
}
export function freePiAgentPath(configDir, id) {
    return join(configDir, "agents", ...id.split("/")) + ".md";
}
async function fileState(path, content) {
    try {
        const current = await readFile(path, "utf8");
        if (current === content)
            return "same";
        // The user replaced or edited this file; never overwrite their work.
        return current.slice(0, 1024).includes(MARKER) ? "write" : "protected";
    }
    catch {
        return "write";
    }
}
/**
 * Writes the bundled agents into the OpenCode config directory so OpenCode's
 * own loader and agent picker own them. Existing files without our marker are
 * treated as user-owned and left untouched.
 */
export async function installFreePiAgents(configDir = openCodeConfigDir()) {
    const installed = [];
    const skipped = [];
    for (const agent of AGENT_FILES) {
        const path = freePiAgentPath(configDir, agent.id);
        const state = await fileState(path, agent.content);
        if (state === "same")
            continue;
        if (state === "protected") {
            skipped.push(agent.id);
            continue;
        }
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, agent.content, "utf8");
        installed.push(agent.id);
    }
    return { installed, skipped, changed: installed.length > 0 };
}
