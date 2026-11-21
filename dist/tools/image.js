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
/**
 * Only images above the provider's 5 MB limit are re-encoded. The CLI sends
 * full-resolution files, and more pixels help OCR; the first JPEG quality that
 * fits is kept instead of forcing an aggressive downscale.
 */
const JPEG_QUALITIES = [92, 85, 75, 62, 50];
/** Refuse to decode absurd canvases that could exhaust memory. */
const MAX_DECODE_DIMENSION = 8_000;
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
function pngSize(bytes) {
    if (bytes.length < 24 || bytes.toString("latin1", 12, 16) !== "IHDR") {
        return undefined;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
}
/** Walks the JPEG markers up to the first Start Of Frame segment. */
function jpegSize(bytes) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if (marker === 0xd8 ||
            marker === 0xd9 ||
            (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2)
            return undefined;
        const sof = (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf);
        if (sof) {
            if (offset + 9 > bytes.length)
                return undefined;
            const height = bytes.readUInt16BE(offset + 5);
            const width = bytes.readUInt16BE(offset + 7);
            return width > 0 && height > 0 ? { width, height } : undefined;
        }
        offset += 2 + length;
    }
    return undefined;
}
function webpSize(bytes) {
    if (bytes.length < 30)
        return undefined;
    const chunk = bytes.toString("latin1", 12, 16);
    if (chunk === "VP8X") {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width, height };
    }
    if (chunk === "VP8 ") {
        if (bytes[23] !== 0x9d ||
            bytes[24] !== 0x01 ||
            bytes[25] !== 0x2a) {
            return undefined;
        }
        const width = bytes.readUInt16LE(26) & 0x3fff;
        const height = bytes.readUInt16LE(28) & 0x3fff;
        return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (chunk === "VP8L") {
        if (bytes[20] !== 0x2f)
            return undefined;
        const bits = bytes.readUInt32LE(21);
        return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1,
        };
    }
    return undefined;
}
/**
 * Reads dimensions from the file header. This avoids decoding typical images
 * with WASM just to decide whether they need to be resized.
 */
export function imageSize(bytes, mime) {
    if (mime === "image/png")
        return pngSize(bytes);
    if (mime === "image/jpeg")
        return jpegSize(bytes);
    return webpSize(bytes);
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
function candidate(bytes, mime) {
    return { data: bytes.toString("base64"), mime, bytes: bytes.length };
}
/**
 * Re-encodes the image at `width` x `height`. It keeps the source format when
 * possible and stops at the first JPEG quality that fits, so one call usually
 * costs a single encode instead of five.
 */
function encodeCandidate(photon, image, width, height, preferred) {
    const resized = photon.resize(image, width, height, photon.SamplingFilter.Lanczos3);
    try {
        // Keep PNG screenshots crisp: JPEG artifacts blur UI text and transparency,
        // and the vision model charges by pixels, not by encoded bytes.
        if (preferred === "image/png") {
            const png = Buffer.from(resized.get_bytes());
            if (png.length <= MAX_IMAGE_BYTES)
                return candidate(png, "image/png");
        }
        if (preferred === "image/webp") {
            try {
                const webp = Buffer.from(resized.get_bytes_webp());
                if (webp.length <= MAX_IMAGE_BYTES)
                    return candidate(webp, "image/webp");
            }
            catch {
                // Older Photon builds may not expose WebP encoding.
            }
        }
        for (const quality of JPEG_QUALITIES) {
            const jpeg = Buffer.from(resized.get_bytes_jpeg(quality));
            if (jpeg.length <= MAX_IMAGE_BYTES)
                return candidate(jpeg, "image/jpeg");
        }
        return undefined;
    }
    finally {
        resized.free();
    }
}
/**
 * Sends the file untouched while it fits the provider's 5 MB limit. Only larger
 * files are decoded, and then kept at the highest resolution/quality that fits.
 *
 * Photon is optional: if its WASM module cannot load, images that already fit
 * are still sent unchanged, while oversized ones fail with a clear message.
 */
export async function prepareImage(bytes, mime, name) {
    // The normal path never touches WASM, so screenshots and phone photos under
    // 5 MB keep their original resolution and add no local processing latency.
    const size = imageSize(bytes, mime);
    if (bytes.length <= MAX_IMAGE_BYTES) {
        return unchanged(bytes, mime, size?.width ?? 0, size?.height ?? 0);
    }
    const photo = await loadPhoton();
    if (!photo) {
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
        return {
            ok: false,
            text: `${name} could not be decoded, so it cannot be reduced below 5 MB.`,
        };
    }
    try {
        const originalWidth = image.get_width();
        const originalHeight = image.get_height();
        const longest = Math.max(originalWidth, originalHeight);
        let scale = longest > MAX_DECODE_DIMENSION
            ? MAX_DECODE_DIMENSION / longest
            : 1;
        while (true) {
            const width = Math.max(1, Math.round(originalWidth * scale));
            const height = Math.max(1, Math.round(originalHeight * scale));
            const best = encodeCandidate(photo, image, width, height, mime);
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
            scale *= 0.85;
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
