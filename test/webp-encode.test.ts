// These tests run the real vendored libwebp .wasm. Nothing here is mocked,
// because a mock would have happily passed for the bug this code exists to fix:
// canvas.toBlob(…, "image/webp") returned a PNG on Safari and the pipeline
// believed it, so the only assertion worth making is on bytes libwebp wrote.
//
// The glue fetches its own .wasm, and Node's fetch has no file:// support, so
// fetch is stubbed here — the same technique the Access tests use for JWKS.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { encodeWebp } from "../public/js/admin/webp.js";

beforeAll(() => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const href = String((input as { url?: string })?.url ?? input);
    if (href.startsWith("file://")) {
      return new Response(readFileSync(fileURLToPath(href)), {
        headers: { "content-type": "application/wasm" },
      });
    }
    return (realFetch as (a: unknown, b: unknown) => Promise<Response>)(input, init);
  }) as typeof fetch;
});

/** Smooth gradients, the way a photo is smooth — noise would compress badly at
 *  every quality and flatten the difference the quality test looks for.
 *
 *  Opaque on purpose: a translucent image makes libwebp emit an extended VP8X
 *  container, which moves every byte offset readWebpSize depends on. */
function photoPixels(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = (i / width) | 0;
    const at = i * 4;
    pixels[at] = ((x * 255) / width) | 0;
    pixels[at + 1] = ((y * 255) / height) | 0;
    pixels[at + 2] = (x * y) & 255;
    pixels[at + 3] = 255;
  }
  return pixels;
}

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/** The size libwebp actually wrote into the VP8 bitstream, not the size we
 *  asked for — those are the same only if the encode really happened. */
function readWebpSize(bytes: Uint8Array) {
  const fourcc = String.fromCharCode(...bytes.slice(12, 16));
  if (fourcc !== "VP8 ") throw new Error(`unexpected container ${JSON.stringify(fourcc)}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint16(26, true) & 0x3fff,
    height: view.getUint16(28, true) & 0x3fff,
  };
}

describe("encodeWebp", () => {
  it("produces a real WebP container, not a renamed PNG", async () => {
    const blob = await encodeWebp(photoPixels(64, 64), 64, 64, 0.82);
    const bytes = await bytesOf(blob);

    expect(blob.type).toBe("image/webp");
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WEBP");
  });

  // Every shape fitWithin can return, including the panorama that rounds to a
  // one-pixel short edge.
  it.each([
    [400, 300],
    [1200, 1200],
    [900, 1200],
    [1200, 900],
    [1200, 1],
    [1, 1],
  ])("writes %ix%i into the bitstream header", async (width, height) => {
    const bytes = await bytesOf(
      await encodeWebp(photoPixels(width, height), width, height, 0.82),
    );
    expect(readWebpSize(bytes)).toEqual({ width, height });
  });

  // libwebp's quality is 0-100 and the pipeline's is 0-1. Passing 0.82 straight
  // through rounds to quality 1, which still returns a valid WebP — measured at
  // 1.7KB against 33.6KB for this image. Only the size tells them apart.
  it("passes quality through on libwebp's 0-100 scale", async () => {
    const pixels = photoPixels(400, 300);
    const good = await encodeWebp(pixels, 400, 300, 0.82);
    const poor = await encodeWebp(pixels, 400, 300, 0.05);

    expect(good.size).toBeGreaterThan(10_000);
    expect(good.size).toBeGreaterThan(poor.size * 4);
  });

  // The encoder is loaded once and reused for every photo in a batch.
  it("encodes repeatedly from one loaded module", async () => {
    const first = await encodeWebp(photoPixels(64, 64), 64, 64, 0.82);
    const second = await encodeWebp(photoPixels(96, 96), 96, 96, 0.82);

    expect(readWebpSize(await bytesOf(first))).toEqual({ width: 64, height: 64 });
    expect(readWebpSize(await bytesOf(second))).toEqual({ width: 96, height: 96 });
  });
});
