import { type Plugin } from "@opencode-ai/plugin";
export declare const FreePiPlugin: Plugin;
declare function FreePiV2Setup(ctx: any): Promise<() => Promise<void>>;
declare const _default: {
    id: string;
    setup: typeof FreePiV2Setup;
    server: Plugin;
};
export default _default;
