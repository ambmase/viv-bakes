import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import {
  createPhoto,
  listFeaturedPhotos,
  listPhotos,
  reorderFeatured,
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

async function threeFeatured() {
  const a = await createPhoto(db(), sample("aaa", "first"));
  const b = await createPhoto(db(), sample("bbb", "second"));
  const c = await createPhoto(db(), sample("ccc", "third"));
  await updatePhoto(db(), a.id, { featured: true });
  await updatePhoto(db(), b.id, { featured: true });
  await updatePhoto(db(), c.id, { featured: true });
  return { a, b, c };
}

it("gives each newly featured photo the next position", async () => {
  const { a, b, c } = await threeFeatured();
  const featured = await listFeaturedPhotos(db());
  expect(featured.map((photo) => photo.id)).toEqual([a.id, b.id, c.id]);
  expect(featured.map((photo) => photo.featured)).toEqual([1, 2, 3]);
});

it("takes a photo off the home page without disturbing the rest", async () => {
  const { a, b, c } = await threeFeatured();
  await updatePhoto(db(), b.id, { featured: false });

  const featured = await listFeaturedPhotos(db());
  expect(featured.map((photo) => photo.id)).toEqual([a.id, c.id]);
  const removed = (await listPhotos(db())).find((photo) => photo.id === b.id);
  expect(removed?.featured).toBe(0);
});

it("re-featuring a photo puts it at the end, not back where it was", async () => {
  const { a, b, c } = await threeFeatured();
  await updatePhoto(db(), a.id, { featured: false });
  await updatePhoto(db(), a.id, { featured: true });

  const featured = await listFeaturedPhotos(db());
  expect(featured.map((photo) => photo.id)).toEqual([b.id, c.id, a.id]);
});

it("orders the home page by its own positions", async () => {
  const { a, b, c } = await threeFeatured();
  await reorderFeatured(db(), [c.id, a.id, b.id]);

  const featured = await listFeaturedPhotos(db());
  expect(featured.map((photo) => photo.id)).toEqual([c.id, a.id, b.id]);
  expect(featured.map((photo) => photo.featured)).toEqual([1, 2, 3]);
});

// The whole point of the change: the home page used to inherit the portfolio's
// order, so rearranging the portfolio silently rearranged the home page.
it("leaves the home page alone when the portfolio is rearranged", async () => {
  const { a, b, c } = await threeFeatured();
  const before = (await listFeaturedPhotos(db())).map((photo) => photo.id);

  await reorderPhotos(db(), [c.id, b.id, a.id]);

  const after = (await listFeaturedPhotos(db())).map((photo) => photo.id);
  expect(after).toEqual(before);
  expect((await listPhotos(db())).map((photo) => photo.id)).toEqual([c.id, b.id, a.id]);
});

it("shows every featured photo, not just the first six", async () => {
  for (let index = 0; index < 8; index++) {
    const photo = await createPhoto(db(), sample(`p${index}`, `photo ${index}`));
    await updatePhoto(db(), photo.id, { featured: true });
  }
  expect(await listFeaturedPhotos(db())).toHaveLength(8);
});

it("returns nothing when no photo is on the home page", async () => {
  await createPhoto(db(), sample("aaa"));
  expect(await listFeaturedPhotos(db())).toEqual([]);
});

it("renumbers from one so positions never drift", async () => {
  const { a, b, c } = await threeFeatured();
  await updatePhoto(db(), a.id, { featured: false });
  await reorderFeatured(db(), [c.id, b.id]);

  const featured = await listFeaturedPhotos(db());
  expect(featured.map((photo) => photo.featured)).toEqual([1, 2]);
});
