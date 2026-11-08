import { env, exports } from "cloudflare:workers";
import { it, expect } from "vitest";
import { photoKeyForBytes, putPhotoObject } from "../src/storage/photos";

const bucket = () => (env as unknown as { PHOTOS: R2Bucket }).PHOTOS;

it("serves a stored photo with immutable cache headers", async () => {
  const bytes = new TextEncoder().encode("photo bytes").buffer;
  const key = await photoKeyForBytes(bytes);
  await putPhotoObject(bucket(), key, bytes);

  const filename = key.slice("photos/".length);
  const response = await exports.default.fetch(
    `https://vivianbakes.com/media/${filename}`,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(await response.text()).toBe("photo bytes");
});

it("404s for a photo that does not exist", async () => {
  const response = await exports.default.fetch(
    "https://vivianbakes.com/media/0123456789abcdef0123456789abcdef.webp",
  );
  expect(response.status).toBe(404);
});

it("rejects path traversal attempts", async () => {
  const response = await exports.default.fetch(
    "https://vivianbakes.com/media/../secrets.txt",
  );
  expect(response.status).toBe(404);
});

// The case above never actually reaches handleMedia: `new URL()` normalises the
// dot-segment away, so the path becomes "/secrets.txt", misses the "/media/"
// prefix, and 404s from static assets no matter what the handler does.
//
// Asserting 404 is also not enough on its own. With the allow-list removed the
// handler still 404s, because the key it then asks R2 for does not exist — the
// test would pass against a completely unguarded handler. So each payload here
// gets a real object planted at exactly the key that payload would resolve to.
// A 404 now means "the allow-list refused it", and removing the regex from
// src/routes/media.ts turns these into 200s serving the planted content.
it("refuses to serve objects named by traversal or malformed keys", async () => {
  const payloads = [
    "/media/foo/../secrets.txt", // normalises to /media/secrets.txt
    "/media/%2e%2e%2fsecrets.txt", // percent-encoded ../
    "/media/..%2fsecrets.txt", // partially encoded ../
    "/media/photos/0123456789abcdef0123456789abcdef.webp", // escapes the prefix
    "/media/0123456789abcdef0123456789abcdef.webp.txt", // wrong extension
    "/media/0123456789ABCDEF0123456789ABCDEF.webp", // uppercase hex
    "/media/0123456789abcdef.webp", // too few hex chars
  ];

  const secret = "SHOULD NEVER BE SERVED";

  for (const payload of payloads) {
    // Mirror how the handler derives its key, then plant an object there.
    const { pathname } = new URL(`https://vivianbakes.com${payload}`);
    expect(pathname.startsWith("/media/"), `${payload} reaches the handler`).toBe(
      true,
    );
    await bucket().put(`photos/${pathname.slice("/media/".length)}`, secret);
  }

  for (const payload of payloads) {
    const response = await exports.default.fetch(
      `https://vivianbakes.com${payload}`,
    );
    expect(response.status, payload).toBe(404);
    expect(await response.text(), payload).not.toContain(secret);
  }
});
