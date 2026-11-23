/** Dependencies shared by the free-pi modules. */
import type { Credential } from "@opencode/schema/credential";
import type { Plugin } from "@opencode/plugin";
import type { Logger } from "./logging.js";
import type { RuntimeState } from "./state.js";
import type { ListSubagentSessions, ReadContext, ReadSessionInfo } from "./types.js";
export type Deps = {
    readonly state: RuntimeState;
    readonly log: Logger;
    readonly activeCredential: () => Promise<Credential.Value | undefined>;
    readonly readContext: ReadContext;
    /** Session headers, used to prove a session is really this session's child. */
    readonly readSession?: ReadSessionInfo;
    readonly listSubagentSessions?: ListSubagentSessions;
    /** Plugin-scoped durable storage, used to reconnect provider sessions. */
    readonly storage?: Plugin.Context["storage"];
};
