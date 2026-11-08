import type { Photo } from "../types";

export async function listPhotos(db: D1Database): Promise<Photo[]> {
  const { results } = await db
    .prepare("SELECT * FROM photos ORDER BY sort_order ASC")
    .all<Photo>();
  return results;
}

/**
 * The home page, in its own order.
 *
 * `featured` carries both facts: 0 is not on the home page, and any higher
 * number is the position. One column cannot disagree with itself the way a
 * separate flag and rank could. The id tiebreak keeps the order stable if two
 * rows ever end up sharing a position.
 */
export async function listFeaturedPhotos(db: D1Database): Promise<Photo[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM photos WHERE featured > 0 ORDER BY featured ASC, id ASC",
    )
    .all<Photo>();
  return results;
}

export async function getPhotoById(
  db: D1Database,
  id: number,
): Promise<Photo | null> {
  return db
    .prepare("SELECT * FROM photos WHERE id = ?")
    .bind(id)
    .first<Photo>();
}

export async function createPhoto(
  db: D1Database,
  input: { r2_key: string; alt: string; width: number; height: number },
): Promise<Photo> {
  const photo = await db
    .prepare(
      `INSERT INTO photos (r2_key, alt, width, height, sort_order)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM photos))
       ON CONFLICT(r2_key) DO UPDATE SET alt = excluded.alt
       RETURNING *`,
    )
    .bind(input.r2_key, input.alt, input.width, input.height)
    .first<Photo>();

  if (!photo) throw new Error("createPhoto returned no row");
  return photo;
}

export async function updatePhoto(
  db: D1Database,
  id: number,
  fields: { alt?: string; featured?: boolean },
): Promise<Photo | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (fields.alt !== undefined) {
    sets.push("alt = ?");
    values.push(fields.alt);
  }
  if (fields.featured !== undefined) {
    if (fields.featured) {
      // Added to the end of the home page. A photo that is already there keeps
      // the position it has.
      sets.push(
        "featured = CASE WHEN featured > 0 THEN featured" +
          " ELSE (SELECT COALESCE(MAX(featured), 0) + 1 FROM photos) END",
      );
    } else {
      sets.push("featured = 0");
    }
  }
  if (sets.length === 0) return getPhotoById(db, id);

  return db
    .prepare(`UPDATE photos SET ${sets.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first<Photo>();
}

export async function deletePhoto(
  db: D1Database,
  id: number,
): Promise<Photo | null> {
  return db
    .prepare("DELETE FROM photos WHERE id = ? RETURNING *")
    .bind(id)
    .first<Photo>();
}

export async function reorderPhotos(
  db: D1Database,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  const statement = db.prepare("UPDATE photos SET sort_order = ? WHERE id = ?");
  await db.batch(ids.map((id, index) => statement.bind(index + 1, id)));
}

/**
 * Renumbers the home page 1..n in the order given. As with `reorderPhotos`,
 * only the ids handed over are touched, so the caller has to submit the
 * complete set — `handleFeaturedOrder` is what enforces that.
 */
export async function reorderFeatured(
  db: D1Database,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  const statement = db.prepare("UPDATE photos SET featured = ? WHERE id = ?");
  await db.batch(ids.map((id, index) => statement.bind(index + 1, id)));
}
