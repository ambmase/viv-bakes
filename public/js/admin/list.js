// Pure ordering and paging logic for the admin photo list. No DOM, no fetch —
// this is the part where a mistake is silent (a wrong id set makes
// PUT /api/photos/order reject the whole batch with a 400), so it lives on its
// own and is tested directly.

/**
 * Moves the item at `fromIndex` to `toIndex`, returning a new array. A target
 * outside the list is clamped to its nearest end; a source outside the list
 * leaves the order alone.
 */
export function moveInList(items, fromIndex, toIndex) {
  const next = [...items];
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= next.length) {
    return next;
  }

  const target = Math.min(Math.max(toIndex, 0), next.length - 1);
  const [item] = next.splice(fromIndex, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Builds the new gallery order after an upload batch: photos that were just
 * created lead, in the order they were uploaded, and everything else keeps its
 * place.
 *
 * Re-uploading a photo that is already in the gallery is idempotent — the API
 * returns the existing row — so its id arrives here even though nothing was
 * created. Such an id must stay where it is (moving it would silently reorder
 * the gallery) and must appear exactly once (a duplicate makes the submitted
 * id set invalid and the API rejects the batch).
 */
export function mergeUploadedIds(existingIds, uploadedIds) {
  const existing = new Set(existingIds);
  const added = [];
  const seen = new Set();

  for (const id of uploadedIds) {
    if (existing.has(id) || seen.has(id)) continue;
    seen.add(id);
    added.push(id);
  }

  return [...added, ...existingIds];
}

/** Number of pages `total` items fill. An empty list is still one page. */
export function pageCount(total, perPage) {
  return Math.max(1, Math.ceil(total / perPage));
}

/** The items on `page` (1-based), clamped into the range that exists. */
export function pageSlice(items, page, perPage) {
  const last = pageCount(items.length, perPage);
  const clamped = Math.min(Math.max(page, 1), last);
  const start = (clamped - 1) * perPage;
  return items.slice(start, start + perPage);
}

/** The 1-based page holding the item at `index`. */
export function pageOf(index, perPage) {
  return Math.max(1, Math.floor(index / perPage) + 1);
}

/**
 * Where a dragged tile should be inserted, given the rectangles of the tiles
 * it is being dragged past (in order, excluding itself) and the pointer.
 *
 * The answer is the number of tiles the pointer has passed in reading order: a
 * tile the pointer is below counts whatever the x is, and within a row it is
 * the horizontal midpoint that decides. Crossing half a tile is what commits
 * the move, so the gap opens where the finger actually is.
 */
export function insertionIndexFor(rects, pointerX, pointerY) {
  let index = 0;
  for (const rect of rects) {
    const belowThisRow = pointerY > rect.top + rect.height;
    const insideThisRow = pointerY > rect.top;
    const pastMiddle = pointerX > rect.left + rect.width / 2;
    if (belowThisRow || (insideThisRow && pastMiddle)) index += 1;
  }
  return index;
}

/**
 * What is waiting to be saved: the difference between the gallery as the
 * server last described it and the gallery as it is on screen.
 *
 * Photos marked for removal are the whole story for their row — an edit to a
 * photo that is about to be deleted is not worth a write — and removing one
 * shifts every photo after it, which must not read as a reorder.
 */
export function pendingChanges(baseline, photos, deletedIds) {
  const before = new Map(baseline.map((photo) => [photo.id, photo]));
  const deleted = baseline
    .map((photo) => photo.id)
    .filter((id) => deletedIds.has(id));

  const alt = [];
  const featured = [];
  const onHomePage = (photo) => photo.featured > 0;

  for (const photo of photos) {
    if (deletedIds.has(photo.id)) continue;
    const original = before.get(photo.id);
    if (!original) continue;
    if (original.alt !== photo.alt) alt.push(photo.id);
    // `featured` holds a position, so a rearrangement renumbers every photo it
    // touches. Only a photo joining or leaving the home page is a membership
    // change; the rest is one reorder, counted once below.
    if (onHomePage(original) !== onHomePage(photo)) featured.push(photo.id);
  }

  // Only the photos on the home page both before and after: one joining or
  // leaving is a membership change, counted above, and it would otherwise
  // shift everything below it and read as a rearrangement too. A photo marked
  // for removal sits in both lists at the same place, so it changes nothing
  // here and needs no special case.
  const inOrder = (list) =>
    list
      .filter(onHomePage)
      .sort((left, right) => left.featured - right.featured)
      .map((photo) => photo.id);
  const now = inOrder(photos);
  const was = inOrder(baseline);
  const shared = now.filter((id) => was.includes(id));
  const sharedBefore = was.filter((id) => now.includes(id));
  const featuredOrderChanged = shared.some(
    (id, index) => sharedBefore[index] !== id,
  );

  const kept = photos.filter((photo) => !deletedIds.has(photo.id));
  const keptBefore = baseline.filter((photo) => !deletedIds.has(photo.id));
  const orderChanged = kept.some(
    (photo, index) => keptBefore[index]?.id !== photo.id,
  );

  return {
    alt,
    featured,
    deleted,
    orderChanged,
    featuredOrderChanged,
    count:
      alt.length +
      featured.length +
      deleted.length +
      (orderChanged ? 1 : 0) +
      (featuredOrderChanged ? 1 : 0),
  };
}

/**
 * What an odd number of home-page photos will look like, or "" when it fills
 * both layouts. The bento grid is two columns on a phone and three from 900px,
 * so six fills both and seven leaves an orphan in both.
 */
export function describeHomeGrid(count) {
  const shortOnDesktop = count % 3 !== 0;
  const shortOnPhone = count % 2 !== 0;
  if (!shortOnDesktop && !shortOnPhone) return "";

  const parts = [];
  if (shortOnDesktop) parts.push(`${count % 3} of 3 on a computer`);
  if (shortOnPhone) parts.push(`${count % 2} of 2 on a phone`);
  return `The last row will be short: ${parts.join(", ")}.`;
}
