import { env, exports } from "cloudflare:workers";
import { beforeEach, it, expect } from "vitest";
import {
  createPhoto,
  reorderFeatured,
  reorderPhotos,
  updatePhoto,
} from "../src/data/photos";
import { escapeHtml, galleryItemHtml } from "../src/render/gallery";
import type { Photo } from "../src/types";

const db = () => (env as unknown as { DB: D1Database }).DB;

beforeEach(async () => {
  await db().prepare("DELETE FROM photos").run();
});

const photo = (overrides: Partial<Photo> = {}): Photo => ({
  id: 1,
  r2_key: "photos/0123456789abcdef0123456789abcdef.webp",
  alt: "A cake",
  width: 1200,
  height: 1200,
  sort_order: 1,
  featured: 0,
  created_at: "2026-07-29 12:00:00",
  ...overrides,
});

it("escapes HTML in alt text", () => {
  expect(escapeHtml(`"Bob's" <cake> & co`)).toBe(
    "&quot;Bob&#39;s&quot; &lt;cake&gt; &amp; co",
  );
});

it("gives the first gallery item fetchpriority and the rest lazy loading", () => {
  const first = galleryItemHtml(photo(), true);
  expect(first).toContain('fetchpriority="high"');
  expect(first).not.toContain('loading="lazy"');

  const later = galleryItemHtml(photo(), false);
  expect(later).toContain('loading="lazy"');
  expect(later).not.toContain("fetchpriority");
});

it("points items at the /media route with explicit dimensions", () => {
  const html = galleryItemHtml(photo(), false);
  expect(html).toContain(
    'href="/media/0123456789abcdef0123456789abcdef.webp"',
  );
  expect(html).toContain('width="1200"');
  expect(html).toContain('height="1200"');
  expect(html).toContain('class="glightbox gallery-item"');
});

it("renders photos from D1 into the portfolio gallery", async () => {
  await createPhoto(db(), {
    r2_key: "photos/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
    alt: "Injected cake",
    width: 1200,
    height: 1200,
  });

  const response = await exports.default.fetch(
    "https://vivianbakes.com/portfolio.html",
  );
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(html).toContain("Injected cake");
  expect(html).toContain("/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp");
  // Injection has to have actually run. This used to assert the old hardcoded
  // markup was gone, which was the stronger check — but that markup is now
  // seeded into D1 and deleted from the page, so the assertion would pass on
  // its own. The placeholder comment is what is left to prove was replaced.
  expect(html).not.toContain("Photos are injected at the edge");
});

it("gives exactly one rendered gallery item fetchpriority", async () => {
  // galleryItemHtml is unit-tested with isFirst true and false, but nothing
  // else checks that renderPortfolio passes isFirst for the first photo only.
  // Marking every image high-priority would defeat the LCP tuning the static
  // markup already does, and no other test would notice.
  for (const key of ["aa", "bb", "cc"]) {
    await createPhoto(db(), {
      r2_key: `photos/${key.repeat(16)}.webp`,
      alt: `Cake ${key}`,
      width: 1200,
      height: 1200,
    });
  }

  const response = await exports.default.fetch(
    "https://vivianbakes.com/portfolio.html",
  );
  const html = await response.text();

  const highPriority = html.match(/fetchpriority="high"/g) ?? [];
  const lazy = html.match(/gallery-item"><img[^>]*loading="lazy"/g) ?? [];

  expect(highPriority).toHaveLength(1);
  expect(lazy).toHaveLength(2);
  // ...and it is the first photo in sort order that got it.
  expect(html).toMatch(
    /alt="Cake aa"[^>]*fetchpriority="high"/,
  );
});

it("renders only featured photos into the home bento grid", async () => {
  const featured = await createPhoto(db(), {
    r2_key: "photos/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
    alt: "Featured cake",
    width: 1200,
    height: 1200,
  });
  await updatePhoto(db(), featured.id, { featured: true });

  await createPhoto(db(), {
    r2_key: "photos/cccccccccccccccccccccccccccccccc.webp",
    alt: "Not featured cake",
    width: 1200,
    height: 1200,
  });

  const response = await exports.default.fetch("https://vivianbakes.com/");
  const html = await response.text();

  expect(html).toContain("Featured cake");
  expect(html).not.toContain("Not featured cake");
});

it("renders an empty grid rather than failing when there are no photos", async () => {
  const response = await exports.default.fetch(
    "https://vivianbakes.com/portfolio.html",
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('class="gallery-grid"');
});

it("leaves other pages untouched", async () => {
  const response = await exports.default.fetch(
    "https://vivianbakes.com/about.html",
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Vivian Bakes");
});

// The home page used to inherit the portfolio's order, so rearranging the
// portfolio silently rearranged the home page. It has its own order now.
it("renders the home page in its own order, not the portfolio's", async () => {
  const ids: number[] = [];
  for (const key of ["a", "b", "c"]) {
    const photo = await createPhoto(db(), {
      r2_key: `photos/${key}.webp`,
      alt: key,
      width: 1200,
      height: 1200,
    });
    await updatePhoto(db(), photo.id, { featured: true });
    ids.push(photo.id);
  }

  await reorderFeatured(db(), [ids[2], ids[0], ids[1]]);
  await reorderPhotos(db(), [ids[1], ids[0], ids[2]]);

  const response = await exports.default.fetch("https://example.com/");
  const html = await response.text();
  const order = [...html.matchAll(/alt="([abc])"/g)].map((match) => match[1]);

  expect(order).toEqual(["c", "a", "b"]);
});
