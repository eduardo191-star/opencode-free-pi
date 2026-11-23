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
export declare const FREE_PI_AGENT_IDS: readonly ["free-pi/scout", "free-pi/planner", "free-pi/worker", "free-pi/reviewer"];
export type FreePiAgentID = (typeof FREE_PI_AGENT_IDS)[number];
export declare const FREE_PI_SKILL_ID = "free-pi";
export declare const FREE_PI_SKILL_NAME = "free-pi";
export declare const FREE_PI_SKILL_DESCRIPTION = "How free-pi works in OpenCode: its tools, the installed native subagents, allowance and limits, and where sessions and memory live.";
export declare const FREE_PI_SKILL = "# free-pi in OpenCode\n\nfree-pi is a free, ad-supported provider for OpenCode. You sign in with GitHub\nand ads in the session pay for the inference; there is no model API key. The\nfree daily allowance is shared by every free-pi model and every tool that spends\nit.\n\n## Tools\n- `free_pi_usage` shows today's remaining allowance, credits, token counts and\n  the account tier. Read-only.\n- `look_at_image` asks a vision model about a PNG, JPEG or WebP inside the\n  project. Use it when the current model takes text only, or when the image is a\n  file on disk and you want a targeted answer instead of attaching it.\n- `generate_image` draws one image from a prompt and saves it under `images/`.\n- `web_search` searches the web for current information.\n- `docs_lookup` looks up current library and framework documentation.\n\nEvery tool except `free_pi_usage` spends allowance. Usage limits\n(`daily_cap`, `rolling_cap`, concurrency) are terminal: stop and continue\nwithout the tool instead of retrying.\n\n## Subagents\n\nUse OpenCode's native subagent tool with the agents this plugin installs:\n\n| Agent | Use it for |\n| --- | --- |\n| `free-pi/scout` | Read-only recon: locate code and return structured findings. |\n| `free-pi/planner` | Read-only plan for a change, ready for a worker. |\n| `free-pi/worker` | Carry out one full task in its own context window. |\n| `free-pi/reviewer` | Read-only review with file and line references. |\n\nSubagents inherit the free-pi model, share the same daily allowance, and run as\nchild sessions in the background. Keep large exploration in a subagent so it\ndoes not fill your own context. Use OpenCode's agent picker or the `subagent`\ntool; do not try to launch them through shell commands.\n\n## Memory and sessions\n\nOpenCode owns memory and context: `AGENTS.md` and configured instruction files\nare loaded natively, sessions persist and resume, and compaction folds long\nconversations into a summary. Put durable project facts in `AGENTS.md` (or a\nfile listed under `instructions`) instead of repeating them in every prompt.\n\n## Native integrations\n\nMCP servers, skills, commands, references and permissions are configured in\nOpenCode as usual; free-pi does not replace them. Prefer those native features\nover running an external CLI.\n";
/**
 * The same skill as a native `SKILL.md`. OpenCode discovers it from the global
 * skills directory, so the file, its ID, its permissions and the `skill` tool
 * all belong to OpenCode instead of a runtime registration.
 */
export declare const FREE_PI_SKILL_FILE = "---\nname: free-pi\ndescription: How free-pi works in OpenCode: its tools, the installed native subagents, allowance and limits, and where sessions and memory live.\n---\n\n<!-- managed by @eduardo191labs/opencode-free-pi; delete this line to keep your own copy -->\n\n# free-pi in OpenCode\n\nfree-pi is a free, ad-supported provider for OpenCode. You sign in with GitHub\nand ads in the session pay for the inference; there is no model API key. The\nfree daily allowance is shared by every free-pi model and every tool that spends\nit.\n\n## Tools\n- `free_pi_usage` shows today's remaining allowance, credits, token counts and\n  the account tier. Read-only.\n- `look_at_image` asks a vision model about a PNG, JPEG or WebP inside the\n  project. Use it when the current model takes text only, or when the image is a\n  file on disk and you want a targeted answer instead of attaching it.\n- `generate_image` draws one image from a prompt and saves it under `images/`.\n- `web_search` searches the web for current information.\n- `docs_lookup` looks up current library and framework documentation.\n\nEvery tool except `free_pi_usage` spends allowance. Usage limits\n(`daily_cap`, `rolling_cap`, concurrency) are terminal: stop and continue\nwithout the tool instead of retrying.\n\n## Subagents\n\nUse OpenCode's native subagent tool with the agents this plugin installs:\n\n| Agent | Use it for |\n| --- | --- |\n| `free-pi/scout` | Read-only recon: locate code and return structured findings. |\n| `free-pi/planner` | Read-only plan for a change, ready for a worker. |\n| `free-pi/worker` | Carry out one full task in its own context window. |\n| `free-pi/reviewer` | Read-only review with file and line references. |\n\nSubagents inherit the free-pi model, share the same daily allowance, and run as\nchild sessions in the background. Keep large exploration in a subagent so it\ndoes not fill your own context. Use OpenCode's agent picker or the `subagent`\ntool; do not try to launch them through shell commands.\n\n## Memory and sessions\n\nOpenCode owns memory and context: `AGENTS.md` and configured instruction files\nare loaded natively, sessions persist and resume, and compaction folds long\nconversations into a summary. Put durable project facts in `AGENTS.md` (or a\nfile listed under `instructions`) instead of repeating them in every prompt.\n\n## Native integrations\n\nMCP servers, skills, commands, references and permissions are configured in\nOpenCode as usual; free-pi does not replace them. Prefer those native features\nover running an external CLI.\n";
/** OpenCode's user-wide config directory, where it loads custom agents. */
export declare function openCodeConfigDir(): string;
export declare function freePiAgentPath(configDir: string, id: FreePiAgentID): string;
export declare function freePiSkillPath(configDir: string): string;
export type AgentInstallResult = {
    readonly installed: FreePiAgentID[];
    readonly skipped: FreePiAgentID[];
    readonly changed: boolean;
};
/**
 * Writes the bundled agents into the OpenCode config directory so OpenCode's
 * own loader and agent picker own them. Existing files without our marker are
 * treated as user-owned and left untouched.
 */
export declare function installFreePiAgents(configDir?: string): Promise<AgentInstallResult>;
export type SkillInstallResult = {
    readonly installed: boolean;
    readonly skipped: boolean;
    readonly changed: boolean;
};
/**
 * Writes the free-pi skill as `skills/free-pi/SKILL.md`, the layout OpenCode's
 * own skill loader reads. A file without our marker is user-owned and stays
 * untouched, exactly like the agent files.
 */
export declare function installFreePiSkill(configDir?: string): Promise<SkillInstallResult>;
