import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const dir = await mkdtemp(join(tmpdir(), "freepi-vision-"));
process.env.FREE_PI_CACHE_DIR = dir;
process.env.FREEPI_CREDENTIALS_PATH = join(dir, "missing-credentials.json");
process.env.FREEPI_BASE_URL = "https://api.test";
delete process.env.FREEPI_JWT;

const { detectMime, imageSize, loadImage, prepareImage } = await import(
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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type, "latin1");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

/** A noisy PNG that stays above 5 MB even after compression. */
function noisyPng(width, height) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * stride] = 0;
    randomFillSync(raw, row * stride + 1, width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 0 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

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
  assert.deepEqual(imageSize(TINY_PNG, "image/png"), {
    width: 1,
    height: 1,
  });

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

  // Header parsing covers the three formats without decoding.
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
  const wideJpg = Buffer.from(wide.get_bytes_jpeg(80));
  const wideWebp = Buffer.from(wide.get_bytes_webp());
  wide.free();
  source.free();
  await writeFile(join(dir, "wide.png"), widePng);

  const expected = { width: 3_000, height: 1_200 };
  assert.deepEqual(imageSize(widePng, "image/png"), expected);
  assert.deepEqual(imageSize(wideJpg, "image/jpeg"), expected);
  assert.deepEqual(imageSize(wideWebp, "image/webp"), expected);

  // Under 5 MB the file is sent untouched: full resolution, no WASM decode.
  const large = loadImage(dir, "wide.png");
  assert.equal(large.ok, true);
  const kept = await prepareImage(large.bytes, large.mime, "wide.png");
  assert.equal(kept.ok, true);
  assert.equal(kept.resized, false);
  assert.equal(kept.width, 3_000);
  assert.equal(kept.height, 1_200);
  assert.equal(kept.mime, "image/png");

  // Only files above 5 MB are re-encoded, keeping the highest resolution and
  // JPEG quality that fit.
  const noise = noisyPng(2_000, 2_000);
  assert.ok(noise.length > 5 * 1024 * 1024);
  await writeFile(join(dir, "noise.png"), noise);
  const noisy = loadImage(dir, "noise.png");
  assert.equal(noisy.ok, true);
  const reduced = await prepareImage(noisy.bytes, noisy.mime, "noise.png");
  assert.equal(reduced.ok, true);
  assert.equal(reduced.resized, true);
  assert.ok(reduced.bytes <= 5 * 1024 * 1024);
  assert.equal(reduced.width, 2_000);
  assert.equal(reduced.height, 2_000);

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

  // A large-but-light image keeps its original resolution.
  const wideResult = await registered.execute(
    { path: "wide.png", question: "What does the screenshot show?" },
    { sessionID: "ses_vision", signal: new AbortController().signal },
  );
  assert.equal(wideResult.metadata.ok, true);
  const wideBody = JSON.parse(
    calls.filter((call) => call.url.endsWith("/tools/vision")).at(-1).body,
  );
  const sent = photon.PhotonImage.new_from_byteslice(
    new Uint8Array(Buffer.from(wideBody.image_b64, "base64")),
  );
  assert.equal(sent.get_width(), 3_000);
  assert.equal(sent.get_height(), 1_200);
  sent.free();

  // Only files above 5 MB are re-encoded, and that is logged.
  const noiseResult = await registered.execute(
    { path: "noise.png", question: "What does the screenshot show?" },
    { sessionID: "ses_vision", signal: new AbortController().signal },
  );
  assert.equal(noiseResult.metadata.ok, true);
  assert.ok(
    infos.some((entry) => /downscaled the image/.test(entry.message)),
    "the resize is logged",
  );
  const noiseBody = JSON.parse(
    calls.filter((call) => call.url.endsWith("/tools/vision")).at(-1).body,
  );
  assert.ok(Buffer.from(noiseBody.image_b64, "base64").length <= 5 * 1024 * 1024);

  // Errors from the vision API keep the CLI's actionable wording.
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: "daily_cap" }), { status: 429 });
  const capped = await registered.execute(
    { path: "shot.png", question: "Anything?" },
    { sessionID: "ses_vision", signal: new AbortController().signal },
  );
  assert.equal(capped.metadata.ok, false);
  assert.match(capped.content[0].text, /free allowance for today/);

  // A transient `rate_limited` is retried instead of failing the turn.
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(
        JSON.stringify({ code: "rate_limited", retry_after_seconds: 0.05 }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ text: "Retry worked.", model: "vision-test" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const retried = await registered.execute(
    { path: "shot.png", question: "Anything now?" },
    { sessionID: "ses_vision", signal: new AbortController().signal },
  );
  assert.equal(retried.metadata.ok, true);
  assert.equal(attempts, 2);
  assert.equal(retried.metadata.attempts, 2);
  assert.match(retried.content[0].text, /Retry worked/);
  assert.ok(
    infos.some((entry) => /waiting for the vision slot/.test(entry.message)),
    "the retry is logged",
  );

  // Concurrent questions are serialized: free-pi accepts one at a time.
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 150));
    active -= 1;
    return new Response(JSON.stringify({ text: "Queued answer." }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const [first, second] = await Promise.all([
    registered.execute(
      { path: "shot.png", question: "First question" },
      { sessionID: "ses_vision", signal: new AbortController().signal },
    ),
    registered.execute(
      { path: "shot.png", question: "Second question" },
      { sessionID: "ses_vision", signal: new AbortController().signal },
    ),
  ]);
  assert.equal(first.metadata.ok, true);
  assert.equal(second.metadata.ok, true);
  assert.equal(maxActive, 1, "only one vision request is in flight");

  console.log("vision tests passed");
} finally {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
}
