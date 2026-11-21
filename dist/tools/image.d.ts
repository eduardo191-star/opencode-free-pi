/**
 * Image loading and downscaling for the `look_at_image` tool.
 *
 * The provider CLI only sends PNG, JPEG and WebP files under 5 MB to
 * `/tools/vision`. OpenCode users routinely point at larger screenshots, so the
 * plugin decodes them locally and re-encodes the smallest candidate below that
 * limit before spending a vision request.
 */
export type VisionMime = "image/png" | "image/jpeg" | "image/webp";
export type LoadedImage = {
    readonly ok: true;
    readonly bytes: Buffer;
    readonly mime: VisionMime;
} | {
    readonly ok: false;
    readonly text: string;
};
export type PreparedImage = {
    readonly ok: true;
    readonly data: string;
    readonly mime: VisionMime;
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
    readonly originalBytes: number;
    readonly originalWidth: number;
    readonly originalHeight: number;
    readonly resized: boolean;
} | {
    readonly ok: false;
    readonly text: string;
};
/** Same limit as the provider CLI's `look_at_image`. */
export declare const MAX_IMAGE_BYTES: number;
/** Reads the file's magic bytes, like the CLI, instead of trusting the name. */
export declare function detectMime(bytes: Uint8Array): VisionMime | undefined;
/**
 * Reads an image only when it resolves inside `cwd`.
 *
 * Paths are checked both before opening and against the real path afterwards,
 * so a symlink cannot escape the project folder.
 */
export declare function loadImage(cwd: string, path: string): LoadedImage;
/**
 * Decodes the image and downscales it when it exceeds 2000 px or 5 MB.
 *
 * Photon is optional: if its WASM module cannot load, images that already fit
 * are still sent unchanged, while oversized ones fail with a clear message.
 */
export declare function prepareImage(bytes: Buffer, mime: VisionMime, name: string): Promise<PreparedImage>;
