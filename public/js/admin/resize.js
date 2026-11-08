// Browser-side image pipeline: decode, resize to a 1200px long edge, and
// encode WebP before upload. Doing this here keeps a 4MB phone photo off a
// phone connection and leaves the Worker doing nothing but hashing bytes.
//
// The encode does NOT go through canvas.toBlob. Safari has no WebP encoder and
// silently returns a PNG instead, so the encoder ships with the page — see
// webp.js, which explains what that cost and why.
//
// `fitWithin` is pure and tested. The encode is tested against the real wasm
// in test/webp-encode.test.ts. Only the canvas step in the middle needs a
// browser, and it is exercised by `npm run preview:admin` on a phone.

import { encodeWebp } from "./webp.js";

export const MAX_EDGE = 1200;
export const QUALITY = 0.82;

/** A file this browser cannot decode — always the user's to fix. */
export class UnsupportedImageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

/**
 * Scales `width` × `height` so its longest edge is at most `maxEdge`, keeping
 * the aspect ratio. A photo already within the limit is left alone rather than
 * upscaled. The short edge never rounds below 1 — a zero-sized canvas throws.
 */
export function fitWithin(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decodes, resizes, and WebP-encodes one picked file.
 *
 * iOS Safari decodes HEIC natively, which is the main path. A desktop browser
 * without HEIC support throws here rather than uploading something the API
 * will refuse.
 */
export async function resizeToWebp(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UnsupportedImageError(
      "this browser can't open that format — save it as a JPEG or PNG first",
    );
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);

    const blob = await encodeWebp(data, width, height, quality);
    return { blob, width, height };
  } finally {
    bitmap.close?.();
  }
}
