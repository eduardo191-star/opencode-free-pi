/**
 * `generate_image`, the free-pi text-to-image tool.
 *
 * The models cannot see images, so the tool writes the server's image into
 * `images/` inside the project and returns the relative path. Same endpoint,
 * limits and error wording as the provider CLI.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { done, fail, freePiRequest, GATED_TEXT, isGatedSession, mappedText, } from "./api.js";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
};
const ERRORS = {
    guest_login_required: "This tool needs a GitHub sign-in; the guest trial cannot use it. Do not retry or work around it; tell the user to sign in, and continue without this tool.",
    guest_unavailable: "The guest trial is not available right now. Do not retry; tell the user to sign in with GitHub, and continue without this tool.",
    daily_cap: "The user's free allowance for today is used up. Do not retry. Tell the user they can get credits at freepi.ai/extra-credits, and continue without this tool.",
    rolling_cap: "The user's short-term usage limit is reached. Do not retry; continue without this tool.",
    rate_limited: "Too many image requests right now. Do not call generate_image again in this turn unless the user asks.",
    not_configured: "Image generation is not available on this server. Do not call generate_image again in this session.",
    upstream_error: "The image provider failed. You may retry once.",
    account_review: "This account is under review, so image generation is disabled. Do not retry; tell the user and continue without it.",
    content_rejected: "The image provider rejected this prompt. Do not retry the same prompt; tell the user and offer to reword it.",
    invalid_request: "The server rejected this request. Do not retry it unchanged.",
};
const IMAGE_INPUT = {
    type: "object",
    additionalProperties: false,
    required: ["prompt"],
    properties: {
        prompt: {
            type: "string",
            minLength: 1,
            maxLength: 1_000,
            description: "What to draw: subject, style, any exact text to render, and composition",
        },
        aspect_ratio: {
            type: "string",
            enum: ["1:1", "16:9", "9:16", "4:3", "3:2"],
            description: "Default 1:1",
        },
        name: {
            type: "string",
            maxLength: 60,
            description: "Short file name hint, e.g. hero-banner; used only for the saved file's name",
        },
    },
};
export function slug(value) {
    return (value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+/, "")
        .slice(0, 40)
        .replace(/-+$/, "") || "image");
}
async function saveImage(directory, relative, bytes) {
    try {
        await mkdir(join(directory, "images"), { recursive: true });
        const handle = await open(join(directory, relative), "wx");
        try {
            await handle.writeFile(bytes);
        }
        finally {
            await handle.close();
        }
        return undefined;
    }
    catch (error) {
        const reasons = {
            EACCES: "permission denied",
            EPERM: "permission denied",
            ENOSPC: "the disk is full",
            ENOENT: "the folder does not exist",
        };
        const why = reasons[error?.code ?? ""] ?? "it could not be written";
        return why;
    }
}
async function executeGenerateImage(ctx, deps, raw, context) {
    if (!isGatedSession(deps, context.sessionID))
        return fail(GATED_TEXT);
    const input = raw;
    const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt)
        return fail("generate_image needs a prompt.");
    const aspectRatio = typeof input?.aspect_ratio === "string" ? input.aspect_ratio : undefined;
    const name = typeof input?.name === "string" ? input.name : undefined;
    const result = await freePiRequest(deps, {
        path: "/tools/image",
        method: "POST",
        body: { prompt, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) },
        timeoutMs: TIMEOUT_MS,
        signal: context.signal,
        label: "The image request",
    });
    if (!result.ok)
        return fail(mappedText(ERRORS, result));
    const data = result.data ?? {};
    const ext = EXT[data.media_type];
    if (!ext) {
        return fail(`The server returned an unsupported image type (${data.media_type}). Nothing was saved.`);
    }
    const bytes = Buffer.from(data.image_b64 ?? "", "base64");
    if (bytes.length === 0) {
        return fail("The server returned an empty image. Nothing was saved.");
    }
    if (bytes.length > MAX_BYTES) {
        return fail("The generated image was too large to save (over 8 MB). Nothing was saved.");
    }
    const relative = `images/${slug(name ?? prompt)}-${randomBytes(3).toString("hex")}.${ext}`;
    const failure = await saveImage(ctx.location.directory, relative, bytes);
    if (failure)
        return fail(`Couldn't save the image to images: ${failure}.`);
    deps.log.info("generate_image saved an image", {
        path: relative,
        bytes: bytes.length,
        mediaType: data.media_type,
        model: data.model,
    });
    return done(`Saved image to ${relative} (${ext}, ${bytes.length} bytes). You cannot see the image; reference this path in your answer or code, and tell the user you could not check how it looks.`, {
        ok: true,
        path: relative,
        ...(typeof data.cost_usd === "number" ? { cost_usd: data.cost_usd } : {}),
        ...(typeof data.model === "string" ? { model: data.model } : {}),
    });
}
export async function registerGenerateImageTool(ctx, deps) {
    return ctx.tool.transform((editor) => {
        editor.add({
            name: "generate_image",
            description: "Generate one image from a text prompt and save it as a file under images/ in the project. Returns the file path; you cannot see the image. Use it only when the user asks for an image, mockup, icon or illustration. Each call uses part of the user's daily allowance.",
            input: IMAGE_INPUT,
            options: { codemode: false },
            execute: (input, context) => executeGenerateImage(ctx, deps, input, context),
        });
    });
}
