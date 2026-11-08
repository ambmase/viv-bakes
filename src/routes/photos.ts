import {
  createPhoto,
  deletePhoto,
  listFeaturedPhotos,
  listPhotos,
  reorderFeatured,
  reorderPhotos,
  updatePhoto,
} from "../data/photos";
import {
  deletePhotoObject,
  photoKeyForBytes,
  putPhotoObject,
} from "../storage/photos";
import type { Env } from "../types";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

async function handleUpload(request: Request, env: Env): Promise<Response> {
  // Checked before parsing: request.formData() buffers the entire multipart
  // body into memory, so a size check on the parsed Blob only fires once the
  // oversized payload is already resident. Content-Length is client-supplied
  // and not authoritative, so the post-parse check below stays as the real
  // limit — this just refuses the obvious cases cheaply.
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return json({ error: "file is too large" }, 400);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "expected multipart/form-data" }, 400);
  }

  const file = form.get("file");
  const rawAlt = form.get("alt");
  // A multipart field can arrive as a File rather than a string; stringifying
  // one yields a non-empty placeholder that would slip past the empty check.
  const alt = typeof rawAlt === "string" ? rawAlt.trim() : "";
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));

  if (!(file instanceof Blob)) {
    return json({ error: "file is required" }, 400);
  }
  if (file.type !== "image/webp") {
    return json({ error: "file must be image/webp" }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ error: "file is too large" }, 400);
  }
  if (alt.length === 0) {
    return json({ error: "alt text is required" }, 400);
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return json(
      { error: "width and height must be positive integers" },
      400,
    );
  }

  const bytes = await file.arrayBuffer();
  const key = await photoKeyForBytes(bytes);

  await putPhotoObject(env.PHOTOS, key, bytes);
  const photo = await createPhoto(env.DB, {
    r2_key: key,
    alt,
    width,
    height,
  });

  return json(photo, 201);
}

/**
 * Reads the `ids` array out of a reorder request and checks it against the set
 * it is allowed to renumber.
 *
 * Both reorder endpoints renumber only the ids they are handed: a partial list
 * would leave the omitted rows at their old positions (risking ties) and a
 * stale id would leave a gap. So the submitted set has to match the current
 * one exactly — same members, no more, no fewer. Returns either the ids or the
 * response explaining the refusal.
 */
async function readOrderedIds(
  request: Request,
  currentIds: number[],
  subject: string,
): Promise<{ ids: number[] } | { error: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: json({ error: "invalid JSON body" }, 400) };
  }

  const ids = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id))) {
    return { error: json({ error: "ids must be an array of integers" }, 400) };
  }

  const submitted = ids as number[];
  const submittedSet = new Set(submitted);
  if (submittedSet.size !== submitted.length) {
    return { error: json({ error: "ids must not contain duplicates" }, 400) };
  }

  const current = new Set(currentIds);
  const matchesExactly =
    submittedSet.size === current.size &&
    [...submittedSet].every((id) => current.has(id));

  if (!matchesExactly) {
    return {
      error: json({ error: `ids must match ${subject} exactly` }, 400),
    };
  }

  return { ids: submitted };
}

async function handleReorder(request: Request, env: Env): Promise<Response> {
  const photos = await listPhotos(env.DB);
  const result = await readOrderedIds(
    request,
    photos.map((photo) => photo.id),
    "the current set of photos",
  );
  if ("error" in result) return result.error;

  await reorderPhotos(env.DB, result.ids);
  return json({ ok: true });
}

async function handleFeaturedOrder(
  request: Request,
  env: Env,
): Promise<Response> {
  const featured = await listFeaturedPhotos(env.DB);
  const result = await readOrderedIds(
    request,
    featured.map((photo) => photo.id),
    "the photos on the home page",
  );
  if ("error" in result) return result.error;

  await reorderFeatured(env.DB, result.ids);
  return json({ ok: true });
}

async function handlePatch(
  request: Request,
  env: Env,
  id: number,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const fields: { alt?: string; featured?: boolean } = {};
  const rawAlt = (body as { alt?: unknown })?.alt;
  const rawFeatured = (body as { featured?: unknown })?.featured;

  if (rawAlt !== undefined) {
    if (typeof rawAlt !== "string" || rawAlt.trim().length === 0) {
      return json({ error: "alt text cannot be empty" }, 400);
    }
    fields.alt = rawAlt.trim();
  }
  if (rawFeatured !== undefined) {
    if (typeof rawFeatured !== "boolean") {
      return json({ error: "featured must be a boolean" }, 400);
    }
    fields.featured = rawFeatured;
  }

  const photo = await updatePhoto(env.DB, id, fields);
  if (!photo) return json({ error: "not found" }, 404);
  return json(photo);
}

async function handleDelete(env: Env, id: number): Promise<Response> {
  // The D1 row goes first: an orphaned R2 object is harmless, but an orphaned
  // row renders a broken image on the live site.
  const photo = await deletePhoto(env.DB, id);
  if (!photo) return json({ error: "not found" }, 404);

  await deletePhotoObject(env.PHOTOS, photo.r2_key);
  return json({ ok: true });
}

/**
 * Handles `/api/photos*`. Assumes the caller has already been authorised —
 * `handleApiRequest` in `src/routes/api.ts` runs `requireAdmin` before
 * dispatching here, so no auth check happens in this file.
 */
export async function handlePhotosRequest(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  if (pathname === "/api/photos") {
    if (request.method === "GET") return json(await listPhotos(env.DB));
    if (request.method === "POST") return handleUpload(request, env);
    return json({ error: "method not allowed" }, 405);
  }

  if (pathname === "/api/photos/order") {
    if (request.method !== "PUT") {
      return json({ error: "method not allowed" }, 405);
    }
    return handleReorder(request, env);
  }

  if (pathname === "/api/photos/featured-order") {
    if (request.method !== "PUT") {
      return json({ error: "method not allowed" }, 405);
    }
    return handleFeaturedOrder(request, env);
  }

  const match = /^\/api\/photos\/(\d+)$/.exec(pathname);
  if (match) {
    const id = Number(match[1]);
    if (request.method === "PATCH") return handlePatch(request, env, id);
    if (request.method === "DELETE") return handleDelete(env, id);
    return json({ error: "method not allowed" }, 405);
  }

  return json({ error: "not found" }, 404);
}
