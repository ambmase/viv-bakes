import { bytesToHex } from "../lib/encoding";

const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function photoKeyForBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = bytesToHex(new Uint8Array(digest));
  return `photos/${hex.slice(0, 32)}.webp`;
}

export async function putPhotoObject(
  bucket: R2Bucket,
  key: string,
  bytes: ArrayBuffer,
): Promise<void> {
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: "image/webp",
      cacheControl: CACHE_CONTROL,
    },
  });
}

export async function deletePhotoObject(
  bucket: R2Bucket,
  key: string,
): Promise<void> {
  await bucket.delete(key);
}
