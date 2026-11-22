/** Domain types shared by the plugin modules. */
export type ReasoningOption = {
    type: "effort";
    values: string[];
} | {
    type: "toggle";
} | {
    type: "budget_tokens";
    min?: number;
    max?: number;
};
export type CatalogModel = {
    id?: string;
    name?: string;
    display_name?: string;
    section?: string;
    tier?: "regular" | "premium";
    input_credits_per_mtok?: number;
    output_credits_per_mtok?: number;
    cache_read_credits_per_mtok?: number;
    cache_write_credits_per_mtok?: number;
    free?: boolean;
    usage_x?: string | null;
    note?: string | null;
    unavailable?: boolean;
    stats_id?: string;
    release_date?: string;
    family?: string;
    reasoning?: boolean;
    reasoning_options?: ReasoningOption[];
    temperature?: boolean;
    tool_call?: boolean;
    attachment?: boolean;
    interleaved?: boolean | string | {
        field: string;
    };
    context_window?: number;
    contextWindow?: number;
    max_tokens?: number;
    maxTokens?: number;
    max_output_tokens?: number;
    limit?: {
        context?: number;
        output?: number;
    };
    modalities?: {
        input?: string[];
        output?: string[];
    };
};
export type ModelsDevModel = {
    id?: string;
    name?: string;
    family?: string;
    release_date?: string;
    reasoning?: boolean;
    reasoning_options?: ReasoningOption[];
    tool_call?: boolean;
    temperature?: boolean;
    attachment?: boolean;
    interleaved?: boolean | string | {
        field: string;
    };
    limit?: {
        context?: number;
        input?: number;
        output?: number;
    };
    modalities?: {
        input?: string[];
        output?: string[];
    };
    cost?: {
        input?: number;
        output?: number;
        cache_read?: number;
        cache_write?: number;
    };
};
export type ModelsDevProvider = {
    models?: Record<string, ModelsDevModel>;
};
export type ModelRegistry = Record<string, ModelsDevProvider>;
export type RegistryCandidate = {
    providerID: string;
    modelID: string;
    model: ModelsDevModel;
};
export type Catalog = {
    min?: string;
    latest?: string;
    default_model?: string;
    notice?: string;
    models?: CatalogModel[];
};
/** Intermediate, SDK-agnostic model shape used while the catalog is built. */
export type ModelDefinition = {
    id: string;
    name: string;
    family?: string;
    release_date?: string;
    reasoning: boolean;
    reasoning_options?: ReasoningOption[];
    variants: Record<string, Record<string, unknown>>;
    /** Model-level provider options, such as the default reasoning effort. */
    settings?: Record<string, unknown>;
    enabled: boolean;
    temperature: boolean;
    tool_call: boolean;
    attachment: boolean;
    interleaved?: boolean | string | {
        field: string;
    };
    cost: {
        input: number;
        output: number;
        cache_read: number;
        cache_write: number;
    };
    limit: {
        context: number;
        output: number;
    };
    modalities: {
        input: string[];
        output: string[];
    };
    status: "active" | "deprecated";
};
export type ModelMap = Record<string, ModelDefinition>;
export type FreePiOptions = {
    includeDefense?: boolean;
    /**
     * Effort used when no variant is picked. Defaults to `medium` so the free
     * models plan before answering. Set `false` to keep the gateway default.
     */
    reasoningEffort?: string | false;
    /**
     * Verify the gateway's real context window once a week and reuse the measured
     * value. Defaults to true; set `false` to stay on the compiled window.
     */
    liveLimits?: boolean;
};
export type MeResponse = {
    handle?: string;
    tier?: string;
    remaining_usd_today?: number;
    cap_usd_today?: number;
    credit_usd?: number;
    consent_version?: string | null;
    notice?: string;
    buy_url?: string;
    allowance_credits?: number;
    remaining_credits_today?: number;
    refill_at?: string;
    lane?: "standard" | "fallback" | "wait" | string;
    bonus_credits?: number;
    bonus_wallet_credits?: number;
    premium_credits?: number;
    premium_bought_credits?: number;
    premium_gifted_credits?: number;
    premium_expiring_credits?: number;
    regular_wallet_credits?: number;
    premium_expires_at?: string;
    credit_tiers?: boolean;
    premium_get_line?: string;
    guest?: boolean;
    visible_allowance?: boolean;
    earn_reward?: Record<string, unknown> | null;
    slow_tier?: Record<string, unknown>;
};
export type MeStatsResponse = MeResponse & {
    credit_credits?: number;
    spent_usd_today?: number;
    request_count_today?: number;
    prompt_tokens_today?: number;
    completion_tokens_today?: number;
    lifetime?: {
        spent_usd?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        request_count?: number;
    };
};
export type QuotaSnapshot = {
    fetchedAt: number;
    token?: string;
    me?: MeResponse;
    stats?: MeStatsResponse;
    error?: string;
    tokenInvalid?: boolean;
};
export type FreePiError = {
    status?: number;
    code: string;
    message?: string;
    limit?: string;
    retry_after_seconds?: number;
    clears_at?: string;
    remaining_credits_today?: number;
    allowance_credits?: number;
};
export type TokenCheckState = "ok" | "invalid" | "unknown";
export type RequestUsage = {
    at: number;
    messageID: string;
    providerID: string;
    modelID: string;
    cost: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
};
export type Credentials = {
    token: string;
    issuer?: string;
};
export type JwtClaims = {
    exp?: number;
    guest?: boolean;
    iss?: string;
};
export type ConnectSession = {
    session_id: string;
    poll_secret: string;
    token?: string;
    confirm_code: string;
    connect_url: string;
    expires_in: number;
    interval: number;
};
export type DeviceSession = {
    session_id: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval: number;
    expires_in?: number;
};
export type SessionResetOutcome = "released" | "none" | "failed" | "unavailable" | "cooldown";
export type AdTurn = {
    turnId: string;
    context?: string;
    impression?: Promise<void>;
};
export type TrackedModel = {
    providerID: string;
    modelID: string;
};
export type ToolStats = {
    meta: string[];
    metaBytes: number;
    failed: string[];
    evicted: boolean;
    started: Map<string, number>;
    compacted: number;
};
export type TokenUsageLike = {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: {
        read?: number;
        write?: number;
    };
};
/** Minimal view of an OpenCode V2 session message. */
export type MessageContentPart = {
    type: string;
    text?: string;
};
export type SessionMessageInfo = {
    type: "user";
    id: string;
    text: string;
} | {
    type: "assistant";
    id: string;
    agent?: string;
    model?: {
        providerID: string;
        id: string;
    };
    content: MessageContentPart[];
} | {
    type: string;
    id?: string;
    [key: string]: unknown;
};
export type ReadContext = (sessionID: string) => Promise<readonly SessionMessageInfo[]>;
