import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "freepi-vision-"));
process.env.FREE_PI_CACHE_DIR = dir;
process.env.FREEPI_CREDENTIALS_PATH = join(dir, "missing-credentials.json");
process.env.FREEPI_BASE_URL = "https://api.test";
delete process.env.FREEPI_JWT;

const { detectMime, loadImage, prepareImage } = await import(
  "../dist/tools/image.js"
);
const { registerVisionTool, visionErrorText } = await import(
  "../dist/tools/vision.js"
);
const { createRuntimeState } = await import("../dist/state.js");

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input.href : input);
  calls.push({ url, headers: init.headers ?? {}, body: init.body });
  if (url.endsWith("/tools/vision")) {
    return new Response(
      JSON.stringify({
        text: "The Save button is visible and aligned right.",
        cost_usd: 0.0012,
        model: "vision-test",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response("{}", { status: 200 });
};

const infos = [];
const deps = {
  state: createRuntimeState(),
  log: {
    log() {},
    info(message, extra) {
      infos.push({ message, extra });
    },
    warn() {},
    error() {},
  },
  activeCredential: async () => ({
    type: "key",
    key: "test-token",
    metadata: { expires: String(Date.now() + 3_600_000) },
  }),
  readContext: async () => [],
};

let registered;
const ctx = {
  location: { directory: dir },
  tool: {
    transform: async (callback) => {
      callback({
        add(tool) {
          registered = tool;
        },
      });
      return { dispose: async () => {} };
    },
  },
};

try {
  await writeFile(join(dir, "shot.png"), TINY_PNG);
  await writeFile(join(dir, "notes.txt"), "not an image");

  assert.equal(detectMime(TINY_PNG), "image/png");

  const loaded = loadImage(dir, "shot.png");
  assert.equal(loaded.ok, true);
  assert.equal(loaded.mime, "image/png");

  assert.equal(loadImage(dir, "../outside.png").ok, false);
  assert.match(loadImage(dir, "../outside.png").text, /inside the project/);
  assert.equal(loadImage(dir, "missing.png").ok, false);
  assert.match(loadImage(dir, "missing.png").text, /No file/);
  assert.equal(loadImage(dir, "notes.txt").ok, false);
  assert.match(loadImage(dir, "notes.txt").text, /PNG, JPEG or WebP/);

  const small = await prepareImage(TINY_PNG, "image/png", "shot.png");
  assert.equal(small.ok, true);
  assert.equal(small.resized, false);
  assert.equal(small.data, TINY_PNG.toString("base64"));

  // A large screenshot is reduced to pi's 2000 px limit without asking the
  // vision server to handle an oversized payload.
  const photon = await import("@silvia-odwyer/photon-node");
  const source = photon.PhotonImage.new_from_byteslice(
    new Uint8Array(TINY_PNG),
  );
  const wide = photon.resize(
    source,
    3000,
    1200,
    photon.SamplingFilter.Lanczos3,
  );
  const widePng = Buffer.from(wide.get_bytes());
  wide.free();
  source.free();
  await writeFile(join(dir, "wide.png"), widePng);

  const large = loadImage(dir, "wide.png");
  assert.equal(large.ok, true);
  const reduced = await prepareImage(
    large.bytes,
    large.mime,
    "wide.png",
  );
  assert.equal(reduced.ok, true);
  assert.equal(reduced.resized, true);
  assert.ok(reduced.width <= 2_000);
  assert.ok(reduced.height <= 2_000);
  assert.ok(reduced.originalBytes > reduced.bytes);

  assert.match(visionErrorText("daily_cap"), /free allowance for today/);
  assert.match(visionErrorText("rate_limited"), /already running/);
  assert.equal(visionErrorText("nope"), undefined);

  await registerVisionTool(ctx, deps);
  assert.equal(registered.name, "look_at_image");

  deps.state.freePiSessions.add("ses_vision");
  const result = await registered.execute(
    { path: "shot.png", question: "Is the Save button visible?" },
    { sessionID: "ses_vision", signal: new AbortController().signal },
  );
  assert.match(result.content[0].text, /Save button is visible/);
  assert.match(result.content[0].text, /shot\.png/);
  assert.equal(result.metadata.ok, true);
  assert.equal(result.metadata.cost_usd, 0.0012);
  assert.equal(result.metadata.model, "vision-test");

  const request = calls.find((call) => call.url.endsWith("/tools/vision"));
  assert.ok(request);
  assert.equal(request.url, "https://api.test/tools/vision");
  assert.equal(request.headers.authorization, "Bearer test-token");
  const body = JSON.parse(request.body);
  assert.equal(body.media_type, "image/png");
  assert.equal(body.question, "Is the Save button visible?");
  assert.equal(body.image_b64, TINY_PNG.toString("base64"));

  // The next call from a non free-pi session must not spend allowance.
  const before = calls.length;
  const blocked = await registered.execute(
    { path: "shot.png", question: "What is this?" },
    { sessionID: "ses_other", signal: new AbortController().signal },
  );
  assert.equal(blocked.metadata.ok, false);
  assert.match(blocked.content[0].text, /only available in free-pi/);
  assert.equal(calls.length, before);

  // A large image is downscaled before the request leaves the plugin.
  const wideResult = await registered.execute(
    { path: "wide.png", question: "What does the screenshot show?" },
    { sessionID: "ses_vision", signal: new AbortController().signal },
  );
  assert.equal(wideResult.metadata.ok, true);
  assert.ok(
    infos.some((entry) => /downscaled the image/.test(entry.message)),
    "the resize is logged",
  );
  const wideBody = JSON.parse(
    calls.filter((call) => call.url.endsWith("/tools/vision")).at(-1).body,
  );
  const sent = photon.PhotonImage.new_from_byteslice(
    new Uint8Array(Buffer.from(wideBody.image_b64, "base64")),
  );
  assert.ok(sent.get_width() <= 2_000);
  assert.ok(sent.get_height() <= 2_000);
  sent.free();

  // Errors from the vision API keep the CLI's actionable wording.
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: "daily_cap" }), { status: 429 });
  const capped = await registered.execute(
    { path: "shot.png", question: "Anything?" },
    { sessionID: "ses_vision", signal: new AbortController().signal },
  );
  assert.equal(capped.metadata.ok, false);
  assert.match(capped.content[0].text, /free allowance for today/);

  console.log("vision tests passed");
} finally {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
}
