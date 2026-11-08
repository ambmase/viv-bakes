import type { Env } from "../types";

const PREFIX = "/media/";
const FILENAME = /^[0-9a-f]{32}\.webp$/;

export async function handleMedia(
  env: Env,
  pathname: string,
): Promise<Response> {
  const filename = pathname.slice(PREFIX.length);

  // Filenames are content hashes. Anything else — including traversal
  // attempts — cannot name a real object, so reject before touching R2.
  if (!FILENAME.test(filename)) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.PHOTOS.get(`photos/${filename}`);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}
