import { env } from "cloudflare:workers";
import { it, expect } from "vitest";
import { bytesToHex, hexToBytes } from "../src/lib/encoding";
import {
  deletePhotoObject,
  photoKeyForBytes,
  putPhotoObject,
} from "../src/storage/photos";

const bucket = () => (env as unknown as { PHOTOS: R2Bucket }).PHOTOS;

it("round-trips hex encoding", () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 255]);
  expect(bytesToHex(bytes)).toBe("00010f10ff");
  expect(hexToBytes("00010f10ff")).toEqual(bytes);
});

it("derives a stable content-addressed key", async () => {
  const bytes = new TextEncoder().encode("pretend this is a webp").buffer;
  const key = await photoKeyForBytes(bytes);

  expect(key).toMatch(/^photos\/[0-9a-f]{32}\.webp$/);
  expect(await photoKeyForBytes(bytes)).toBe(key);
});

it("derives different keys for different content", async () => {
  const a = await photoKeyForBytes(new TextEncoder().encode("a").buffer);
  const b = await photoKeyForBytes(new TextEncoder().encode("b").buffer);
  expect(a).not.toBe(b);
});

it("stores and deletes an object with the webp content type", async () => {
  const bytes = new TextEncoder().encode("bytes").buffer;
  const key = await photoKeyForBytes(bytes);

  await putPhotoObject(bucket(), key, bytes);
  const stored = await bucket().get(key);
  expect(stored).not.toBeNull();
  expect(stored?.httpMetadata?.contentType).toBe("image/webp");

  await deletePhotoObject(bucket(), key);
  expect(await bucket().get(key)).toBeNull();
});
