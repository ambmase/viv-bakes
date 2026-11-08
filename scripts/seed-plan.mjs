// The decisions the seed makes, separated from the I/O that carries them out.
//
// The seed runs twice and then never again, so every value it writes is
// effectively permanent: the admin can edit alt text and both orders, but
// nothing in it can correct a wrong width or height. That asymmetry is why the
// parsing and the row-building live here, under test, and scripts/seed.mjs is
// left holding only file reads and wrangler calls.

/** Where one grid's markup starts and ends.
 *
 *  The grids hold anchors and nothing else — no nested <div> — so the first
 *  closing tag after the opening one is the right end. parseGrid throws if the
 *  container is missing, which is what makes that assumption safe to hold: a
 *  restructured page fails loudly instead of parsing a slice of something else.
 */
function gridMarkup(html, containerClass) {
  const open = html.indexOf(`class="${containerClass}"`);
  if (open === -1) {
    throw new Error(`No element with class="${containerClass}" in this page.`);
  }
  const end = html.indexOf("</div>", open);
  return html.slice(open, end === -1 ? html.length : end);
}

const ITEM =
  /<a href="images\/([^"]+)"[^>]*>\s*<img[^>]*alt="([^"]*)"[^>]*width="(\d+)"[^>]*height="(\d+)"/g;

/** The photos of one grid, in the order they appear on the page. */
export function parseGrid(html, containerClass) {
  const items = [];

  for (const match of gridMarkup(html, containerClass).matchAll(ITEM)) {
    items.push({
      file: match[1],
      alt: match[2],
      width: Number(match[3]),
      height: Number(match[4]),
    });
  }

  if (items.length === 0) {
    throw new Error(
      `Found no items in .${containerClass}. Has the grid already been emptied?`,
    );
  }

  return items;
}

/** The size in the VP8 bitstream itself.
 *
 *  Every gallery photo is lossy VP8, which puts the dimensions at a fixed
 *  offset. A lossless or extended container moves them, so this refuses to read
 *  one rather than return a plausible wrong number for a permanent column.
 */
export function webpSize(bytes) {
  const fourcc = String.fromCharCode(...bytes.slice(12, 16));
  if (fourcc !== "VP8 ") {
    throw new Error(`Cannot read the size of a ${fourcc} container.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint16(26, true) & 0x3fff,
    height: view.getUint16(28, true) & 0x3fff,
  };
}

/** The same key the admin's upload path derives, so a re-upload of a seeded
 *  photo collides on r2_key instead of becoming a second copy. Kept in step
 *  with photoKeyForBytes in src/storage/photos.ts by a test. */
export async function photoKey(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `photos/${hex.slice(0, 32)}.webp`;
}

// A photo may be scaled differently from what the markup reserves space for —
// black-cake.webp really is 1500x1500 under a width="1200" — but a different
// *shape* means the file is not the photo the page was built around.
const ASPECT_TOLERANCE = 0.005;

export function buildRows({ gallery, home, sizeOf }) {
  const order = new Map(gallery.map((item, index) => [item.file, index]));

  for (const item of home) {
    if (!order.has(item.file)) {
      throw new Error(
        `The home page shows ${item.file}, which is not in the portfolio gallery.`,
      );
    }
  }

  const position = new Map(home.map((item, index) => [item.file, index + 1]));
  const homeAlt = new Map(home.map((item) => [item.file, item.alt]));

  return gallery.map((item, index) => {
    const actual = sizeOf(item.file);
    if (!actual) throw new Error(`No file on disk for ${item.file}.`);

    const declared = item.width / item.height;
    if (Math.abs(declared - actual.width / actual.height) > ASPECT_TOLERANCE) {
      throw new Error(
        `${item.file} is ${actual.width}x${actual.height} on disk but the page ` +
          `reserves ${item.width}x${item.height} — a different shape, not a rescale.`,
      );
    }

    // One row per photo, so the two pages' alt text has to become one. The
    // longer one is the more descriptive one in every case here, and it is the
    // half of the pair that would otherwise be lost. Editable in the admin.
    const other = homeAlt.get(item.file) ?? "";
    const alt = other.length > item.alt.length ? other : item.alt;

    return {
      file: item.file,
      alt,
      width: actual.width,
      height: actual.height,
      sortOrder: index + 1,
      // A position, not a flag: 0 is off the home page, 1..n is the slot.
      featured: position.get(item.file) ?? 0,
    };
  });
}

export function toSql(rows) {
  const values = rows
    .map(
      (row) =>
        `('${row.key}', '${row.alt.replace(/'/g, "''")}', ${row.width}, ` +
        `${row.height}, ${row.sortOrder}, ${row.featured})`,
    )
    .join(",\n");

  return (
    "INSERT INTO photos (r2_key, alt, width, height, sort_order, featured) VALUES\n" +
    values +
    "\nON CONFLICT(r2_key) DO NOTHING;\n"
  );
}
