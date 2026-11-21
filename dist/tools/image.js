/**
 * Image loading and downscaling for the `look_at_image` tool.
 *
 * The provider CLI only sends PNG, JPEG and WebP files under 5 MB to
 * `/tools/vision`. OpenCode users routinely point at larger screenshots, so the
 * plugin decodes them locally and re-encodes the smallest candidate below that
 * limit before spending a vision request.
 */
import { closeSync, fstatSync, openSync, readSync, realpathSync, } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
/** Same limit as the provider CLI's `look_at_image`. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Refuse to read absurd files before decoding them in memory. */
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
/** pi's attachment limit: 2000 x 2000 is enough for screenshots and UI QA. */
const MAX_DIMENSION = 2_000;
const JPEG_QUALITIES = [80, 70, 55, 40];
const OUTSIDE = "look_at_image only reads images inside the project folder.";
let photonPromise;
/** Loads Photon lazily so the plugin startup does not pay for the WASM module. */
function loadPhoton() {
    photonPromise ??= import("@silvia-odwyer/photon-node").catch(() => undefined);
    return photonPromise;
}
function outside(root, path) {
    const rel = relative(root, path);
    const value = process.platform === "win32" ? rel.toLowerCase() : rel;
    return (value === "" ||
        value === ".." ||
        value.startsWith(`..${sep}`) ||
        isAbsolute(rel));
}
/** Reads the file's magic bytes, like the CLI, instead of trusting the name. */
export function detectMime(bytes) {
    if (bytes.length >= 8 &&
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71 &&
        bytes[4] === 13 &&
        bytes[5] === 10 &&
        bytes[6] === 26 &&
        bytes[7] === 10) {
        return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
        return "image/jpeg";
    }
    if (bytes.length >= 12 &&
        Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF" &&
        Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP") {
        return "image/webp";
    }
    return undefined;
}
/**
 * Reads an image only when it resolves inside `cwd`.
 *
 * Paths are checked both before opening and against the real path afterwards,
 * so a symlink cannot escape the project folder.
 */
export function loadImage(cwd, path) {
    let fd;
    try {
        const root = realpathSync(cwd);
        const target = resolve(root, path);
        if (outside(root, target))
            return { ok: false, text: OUTSIDE };
        fd = openSync(target, "r");
        const real = realpathSync(target);
        if (outside(root, real))
            return { ok: false, text: OUTSIDE };
        const stat = fstatSync(fd);
        if (!stat.isFile())
            return { ok: false, text: `${path} is not a file.` };
        if (stat.size > MAX_SOURCE_BYTES) {
            return {
                ok: false,
                text: `${path} is larger than 80 MB, so it cannot be processed. Crop it first.`,
            };
        }
        const data = Buffer.alloc(stat.size);
        let read = 0;
        while (read < stat.size) {
            const chunk = readSync(fd, data, read, stat.size - read, read);
            if (chunk === 0)
                break;
            read += chunk;
        }
        const bytes = data.subarray(0, read);
        const mime = detectMime(bytes);
        if (!mime) {
            return { ok: false, text: `${path} is not a PNG, JPEG or WebP image.` };
        }
        return { ok: true, bytes, mime };
    }
    catch (error) {
        if (error?.code === "ENOENT")
            return { ok: false, text: `No file at ${path}.` };
        return { ok: false, text: `Could not read ${path}.` };
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
function unchanged(bytes, mime, width, height) {
    return {
        ok: true,
        data: bytes.toString("base64"),
        mime,
        bytes: bytes.length,
        width,
        height,
        originalBytes: bytes.length,
        originalWidth: width,
        originalHeight: height,
        resized: false,
    };
}
/**
 * Re-encodes the image at `width` x `height`, trying PNG and several JPEG
 * qualities, and returns the smallest candidate under the size limit.
 */
function encodeCandidate(photon, image, width, height) {
    const resized = photon.resize(image, width, height, photon.SamplingFilter.Lanczos3);
    try {
        const png = Buffer.from(resized.get_bytes());
        const candidates = [
            { data: png.toString("base64"), mime: "image/png", bytes: png.length },
        ];
        for (const quality of JPEG_QUALITIES) {
            const jpeg = Buffer.from(resized.get_bytes_jpeg(quality));
            candidates.push({
                data: jpeg.toString("base64"),
                mime: "image/jpeg",
                bytes: jpeg.length,
            });
        }
        return candidates
            .filter((candidate) => candidate.bytes <= MAX_IMAGE_BYTES)
            .sort((a, b) => a.bytes - b.bytes)[0];
    }
    finally {
        resized.free();
    }
}
/**
 * Decodes the image and downscales it when it exceeds 2000 px or 5 MB.
 *
 * Photon is optional: if its WASM module cannot load, images that already fit
 * are still sent unchanged, while oversized ones fail with a clear message.
 */
export async function prepareImage(bytes, mime, name) {
    const photo = await loadPhoton();
    if (!photo) {
        if (bytes.length <= MAX_IMAGE_BYTES)
            return unchanged(bytes, mime, 0, 0);
        return {
            ok: false,
            text: `${name} is larger than 5 MB and image resizing is unavailable in this OpenCode runtime. Resize it first.`,
        };
    }
    let image;
    try {
        image = photo.PhotonImage.new_from_byteslice(new Uint8Array(bytes));
    }
    catch {
        if (bytes.length <= MAX_IMAGE_BYTES)
            return unchanged(bytes, mime, 0, 0);
        return {
            ok: false,
            text: `${name} could not be decoded, so it cannot be reduced below 5 MB.`,
        };
    }
    try {
        const originalWidth = image.get_width();
        const originalHeight = image.get_height();
        if (originalWidth <= MAX_DIMENSION &&
            originalHeight <= MAX_DIMENSION &&
            bytes.length <= MAX_IMAGE_BYTES) {
            return unchanged(bytes, mime, originalWidth, originalHeight);
        }
        let width = originalWidth;
        let height = originalHeight;
        if (width > MAX_DIMENSION) {
            height = Math.max(1, Math.round((height * MAX_DIMENSION) / width));
            width = MAX_DIMENSION;
        }
        if (height > MAX_DIMENSION) {
            width = Math.max(1, Math.round((width * MAX_DIMENSION) / height));
            height = MAX_DIMENSION;
        }
        while (true) {
            const best = encodeCandidate(photo, image, width, height);
            if (best) {
                return {
                    ok: true,
                    data: best.data,
                    mime: best.mime,
                    bytes: best.bytes,
                    width,
                    height,
                    originalBytes: bytes.length,
                    originalWidth,
                    originalHeight,
                    resized: true,
                };
            }
            if (width === 1 && height === 1)
                break;
            const nextWidth = width === 1 ? 1 : Math.max(1, Math.floor(width * 0.75));
            const nextHeight = height === 1 ? 1 : Math.max(1, Math.floor(height * 0.75));
            if (nextWidth === width && nextHeight === height)
                break;
            width = nextWidth;
            height = nextHeight;
        }
        return {
            ok: false,
            text: `${name} could not be resized below 5 MB. Crop it first.`,
        };
    }
    finally {
        image.free();
    }
}
