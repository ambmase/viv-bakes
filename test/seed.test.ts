// The seed runs twice — once locally, once against production — and then never
// again. Everything it decides (order, home-page positions, alt text,
// dimensions) becomes a permanent row that no UI can fully correct: the admin
// edits alt and order, but not width or height. So the decisions are pure
// functions here, tested, and scripts/seed.mjs only does the I/O.

import { describe, expect, it } from "vitest";
import {
  buildRows,
  parseGrid,
  photoKey,
  toSql,
  webpSize,
} from "../scripts/seed-plan.mjs";
import { photoKeyForBytes } from "../src/storage/photos";

const galleryHtml = `
  <div class="gallery-grid">
    <a href="images/one.webp" class="glightbox gallery-item">
      <img src="images/one.webp" alt="One" width="1200" height="1200" fetchpriority="high" decoding="async" />
    </a>
    <a href="images/two.webp" class="glightbox gallery-item">
      <img src="images/two.webp" alt="Two" width="960" height="1280" loading="lazy" decoding="async" />
    </a>
  </div>
  <footer><a href="images/not-a-gallery-item.webp"><img alt="Nope" width="1" height="1" /></a></footer>
`;

const homeHtml = `
  <div class="bento-grid">
    <a href="images/two.webp" class="glightbox bento-item">
      <img src="images/two.webp" alt="Two, described at length" width="960" height="1280" loading="lazy" decoding="async" />
    </a>
  </div>
`;

const sizes = {
  "one.webp": { width: 1200, height: 1200 },
  "two.webp": { width: 960, height: 1280 },
};
const sizeOf = (file: string) => sizes[file as keyof typeof sizes];

const plan = (overrides: Record<string, unknown> = {}) =>
  buildRows({
    gallery: parseGrid(galleryHtml, "gallery-grid"),
    home: parseGrid(homeHtml, "bento-grid"),
    sizeOf,
    ...overrides,
  });

describe("parseGrid", () => {
  it("reads the items of one grid in document order", () => {
    expect(parseGrid(galleryHtml, "gallery-grid")).toEqual([
      { file: "one.webp", alt: "One", width: 1200, height: 1200 },
      { file: "two.webp", alt: "Two", width: 960, height: 1280 },
    ]);
  });

  it("ignores images outside the named grid", () => {
    // The regex alone would happily match the footer anchor and seed a photo
    // that was never in the gallery.
    const files = parseGrid(galleryHtml, "gallery-grid").map((i) => i.file);
    expect(files).not.toContain("not-a-gallery-item.webp");
  });

  it("throws when the grid has already been emptied", () => {
    // Step 4 replaces the markup with a comment. Re-running the seed then has
    // no source of truth, and silently seeding nothing would look like success.
    expect(() =>
      parseGrid('<div class="gallery-grid"><!-- injected --></div>', "gallery-grid"),
    ).toThrow(/no items/i);
  });

  it("throws when the grid is not in the page at all", () => {
    // Deliberately a page that has an item but no container: if the slice were
    // skipped the item would parse and no error would be raised at all. A page
    // with neither cannot tell the two failures apart — both mention the class.
    const orphan =
      '<a href="images/one.webp"><img alt="One" width="1" height="1" /></a>';

    expect(() => parseGrid(orphan, "gallery-grid")).toThrow(
      /No element with class="gallery-grid"/,
    );
  });
});

describe("webpSize", () => {
  const lossy = (width: number, height: number) => {
    const bytes = new Uint8Array(32);
    bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    bytes.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
    bytes.set([..."VP8 "].map((c) => c.charCodeAt(0)), 12);
    new DataView(bytes.buffer).setUint16(26, width, true);
    new DataView(bytes.buffer).setUint16(28, height, true);
    return bytes;
  };

  it("reads the size out of a lossy VP8 bitstream", () => {
    expect(webpSize(lossy(1500, 1200))).toEqual({ width: 1500, height: 1200 });
  });

  it("throws on a container it cannot read rather than guessing", () => {
    const vp8l = lossy(10, 10);
    vp8l.set([..."VP8L"].map((c) => c.charCodeAt(0)), 12);
    expect(() => webpSize(vp8l)).toThrow(/VP8L/);
  });
});

describe("buildRows", () => {
  it("numbers sort_order 1..n in portfolio order", () => {
    expect(plan().map((row) => [row.file, row.sortOrder])).toEqual([
      ["one.webp", 1],
      ["two.webp", 2],
    ]);
  });

  it("gives the home page its own positions, not a repeated flag", () => {
    // featured is a position: writing 1 for every home-page photo makes
    // ORDER BY featured ASC, id ASC fall back to id order.
    const home = parseGrid(
      `<div class="bento-grid">
         <a href="images/two.webp"><img alt="Two" width="960" height="1280" /></a>
         <a href="images/one.webp"><img alt="One" width="1200" height="1200" /></a>
       </div>`,
      "bento-grid",
    );
    const rows = buildRows({ gallery: parseGrid(galleryHtml, "gallery-grid"), home, sizeOf });

    expect(rows.map((row) => [row.file, row.featured])).toEqual([
      ["one.webp", 2],
      ["two.webp", 1],
    ]);
  });

  it("leaves photos that are not on the home page at featured 0", () => {
    expect(plan().find((row) => row.file === "one.webp")?.featured).toBe(0);
  });

  it("throws when the home page names a photo the gallery does not have", () => {
    const home = parseGrid(
      `<div class="bento-grid"><a href="images/ghost.webp"><img alt="Ghost" width="1" height="1" /></a></div>`,
      "bento-grid",
    );
    expect(() => plan({ home })).toThrow(/ghost\.webp/);
  });

  it("keeps the longer alt text when the two pages disagree", () => {
    expect(plan().find((row) => row.file === "two.webp")?.alt).toBe(
      "Two, described at length",
    );
  });

  it("keeps the portfolio alt when it is the longer one", () => {
    const home = parseGrid(
      `<div class="bento-grid"><a href="images/two.webp"><img alt="Two" width="960" height="1280" /></a></div>`,
      "bento-grid",
    );
    const long = galleryHtml.replace('alt="Two"', 'alt="Two, at length"');
    const rows = buildRows({ gallery: parseGrid(long, "gallery-grid"), home, sizeOf });

    expect(rows.find((row) => row.file === "two.webp")?.alt).toBe("Two, at length");
  });

  it("stores the dimensions of the real file, not the ones the markup claims", () => {
    // black-cake.webp is 1500x1500 but the markup says 1200x1200. Nothing in
    // the admin can correct a wrong width or height later.
    const rows = buildRows({
      gallery: parseGrid(galleryHtml, "gallery-grid"),
      home: parseGrid(homeHtml, "bento-grid"),
      sizeOf: (file: string) =>
        file === "one.webp" ? { width: 1500, height: 1500 } : sizes[file as keyof typeof sizes],
    });

    expect(rows[0]).toMatchObject({ file: "one.webp", width: 1500, height: 1500 });
  });

  it("throws when the real file is a different shape from the markup", () => {
    // A scaled copy is fine; a differently-shaped one means the file was
    // swapped and the page's reserved space is wrong.
    expect(() =>
      plan({ sizeOf: () => ({ width: 1200, height: 800 }) }),
    ).toThrow(/one\.webp/);
  });
});

describe("toSql", () => {
  const row = {
    key: "photos/0123456789abcdef0123456789abcdef.webp",
    alt: "A cake",
    width: 1200,
    height: 1200,
    sortOrder: 1,
    featured: 0,
  };

  it("writes one VALUES tuple per row", () => {
    expect(toSql([row])).toContain(
      "('photos/0123456789abcdef0123456789abcdef.webp', 'A cake', 1200, 1200, 1, 0)",
    );
  });

  it("escapes apostrophes so a caption cannot end the string literal", () => {
    // "Thirty" and "RIP to my 20s" are both quoted in the real alt text.
    expect(toSql([{ ...row, alt: "Cream 'Thirty' cake" }])).toContain(
      "'Cream ''Thirty'' cake'",
    );
  });

  it("re-runs without duplicating rows", () => {
    expect(toSql([row])).toContain("ON CONFLICT(r2_key) DO NOTHING");
  });
});

describe("photoKey", () => {
  it("produces the key the upload path would produce for the same bytes", async () => {
    // The admin hashes uploads with photoKeyForBytes. If the seed disagreed,
    // re-uploading a seeded photo would create a second object and a second
    // row instead of colliding on r2_key.
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    expect(await photoKey(bytes)).toBe(
      await photoKeyForBytes(bytes.buffer as ArrayBuffer),
    );
  });
});
