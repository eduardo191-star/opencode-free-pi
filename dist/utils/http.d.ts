/** JSON request helpers for the free-pi HTTP API. */
export declare function postJson(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
export declare function postJsonRetry(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
export declare function failureText(status: number, body: any): string;
