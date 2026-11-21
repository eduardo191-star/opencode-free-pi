/** free-pi sign-in flows: browser connect and GitHub device code. */
import type { ConnectSession, DeviceSession } from "../types.js";
export declare function startConnect(clientVersion: string): Promise<ConnectSession>;
export declare function startDevice(): Promise<DeviceSession>;
export declare function submitConsent(sessionId: string): Promise<void>;
export declare function pollForToken(request: () => Promise<Response>, interval: number, expiresIn: number): Promise<string>;
export declare function deviceUrl(session: DeviceSession): string;
