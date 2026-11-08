import { env } from "cloudflare:workers";
import { beforeEach, it, expect } from "vitest";
import {
  createPhoto,
  deletePhoto,
  getPhotoById,
  listFeaturedPhotos,
  listPhotos,
  reorderPhotos,
  updatePhoto,
} from "../src/data/photos";

const db = () => (env as unknown as { DB: D1Database }).DB;

beforeEach(async () => {
  await db().prepare("DELETE FROM photos").run();
});

const sample = (key: string, alt = "A cake") => ({
  r2_key: `photos/${key}.webp`,
  alt,
  width: 1200,
  height: 1200,
});

it("creates a photo at the end of the order", async () => {
  const first = await createPhoto(db(), sample("aaa"));
  const second = await createPhoto(db(), sample("bbb"));

  expect(first.sort_order).toBe(1);
  expect(second.sort_order).toBe(2);
  expect(second.alt).toBe("A cake");
  expect(second.featured).toBe(0);
});

it("lists photos in sort order", async () => {
  await createPhoto(db(), sample("aaa", "first"));
  await createPhoto(db(), sample("bbb", "second"));

  const photos = await listPhotos(db());
  expect(photos.map((p) => p.alt)).toEqual(["first", "second"]);
});

it("treats a duplicate r2_key as an update, not an error", async () => {
  const original = await createPhoto(db(), sample("aaa", "old text"));
  const again = await createPhoto(db(), sample("aaa", "new text"));

  expect(again.id).toBe(original.id);
  expect(again.alt).toBe("new text");
  expect(await listPhotos(db())).toHaveLength(1);
});

it("updates alt text and the featured flag independently", async () => {
  const photo = await createPhoto(db(), sample("aaa"));

  const withAlt = await updatePhoto(db(), photo.id, { alt: "Updated" });
  expect(withAlt?.alt).toBe("Updated");
  expect(withAlt?.featured).toBe(0);

  const withFeatured = await updatePhoto(db(), photo.id, { featured: true });
  expect(withFeatured?.featured).toBe(1);
  expect(withFeatured?.alt).toBe("Updated");
});

it("returns null when updating a photo that does not exist", async () => {
  expect(await updatePhoto(db(), 999, { alt: "x" })).toBeNull();
});

it("lists only the photos on the home page", async () => {
  for (const key of ["a", "b", "c"]) {
    const photo = await createPhoto(db(), sample(key));
    await updatePhoto(db(), photo.id, { featured: true });
  }
  await createPhoto(db(), sample("d"));

  expect(await listFeaturedPhotos(db())).toHaveLength(3);
});

// The home page renders exactly six featured photos, so the default limit is a
// behavioural requirement rather than an arbitrary default. The test above never
// exceeds six, so it would pass even with no LIMIT clause at all.

it("deletes a photo and returns the deleted row", async () => {
  const photo = await createPhoto(db(), sample("aaa"));

  const deleted = await deletePhoto(db(), photo.id);
  expect(deleted?.r2_key).toBe("photos/aaa.webp");
  expect(await getPhotoById(db(), photo.id)).toBeNull();
  expect(await deletePhoto(db(), photo.id)).toBeNull();
});

it("reorders photos to match the given id order", async () => {
  const a = await createPhoto(db(), sample("a", "a"));
  const b = await createPhoto(db(), sample("b", "b"));
  const c = await createPhoto(db(), sample("c", "c"));

  await reorderPhotos(db(), [c.id, a.id, b.id]);

  const photos = await listPhotos(db());
  expect(photos.map((p) => p.alt)).toEqual(["c", "a", "b"]);
  expect(photos.map((p) => p.sort_order)).toEqual([1, 2, 3]);
});
