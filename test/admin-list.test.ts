import { describe, expect, it } from "vitest";
import {
  describeHomeGrid,
  insertionIndexFor,
  pendingChanges,
  mergeUploadedIds,
  moveInList,
  pageCount,
  pageOf,
  pageSlice,
} from "../public/js/admin/list.js";

describe("moveInList", () => {
  it("moves an item down", () => {
    expect(moveInList(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves an item up", () => {
    expect(moveInList(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("moves an item by one without disturbing the rest", () => {
    expect(moveInList(["a", "b", "c", "d"], 2, 1)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("leaves the input array untouched", () => {
    const items = ["a", "b", "c"];
    moveInList(items, 0, 2);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("clamps a target past the end to the last position", () => {
    expect(moveInList(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
  });

  // A negative target means "the first position", not splice's
  // count-back-from-the-end: with five items, moving the last to -2 puts it
  // at the front, not two from the back.
  it("clamps a negative target to the first position", () => {
    expect(moveInList(["a", "b", "c", "d", "e"], 4, -2)).toEqual([
      "e",
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("returns an unchanged copy when the source index does not exist", () => {
    expect(moveInList(["a", "b", "c"], 7, 0)).toEqual(["a", "b", "c"]);
    expect(moveInList(["a", "b", "c"], -1, 0)).toEqual(["a", "b", "c"]);
  });

  it("keeps every member exactly once", () => {
    const moved = moveInList([1, 2, 3, 4, 5], 3, 1);
    expect([...moved].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("mergeUploadedIds", () => {
  it("puts newly uploaded ids at the front, in upload order", () => {
    expect(mergeUploadedIds([1, 2, 3], [7, 8])).toEqual([7, 8, 1, 2, 3]);
  });

  // A re-upload of a photo already in the gallery returns that existing row,
  // so its id arrives in `uploaded` even though nothing new was created.
  // Moving it would silently reorder the gallery; sending it twice would make
  // the id set wrong and PUT /api/photos/order would reject the whole batch.
  it("leaves an already-present id where it is", () => {
    expect(mergeUploadedIds([1, 2, 3], [2])).toEqual([1, 2, 3]);
  });

  it("leads with the genuinely new ids and leaves the duplicate in place", () => {
    const merged = mergeUploadedIds([1, 2, 3], [9, 2]);
    expect(merged).toEqual([9, 1, 2, 3]);
    expect(new Set(merged).size).toBe(merged.length);
  });

  it("collapses an id uploaded twice in one batch", () => {
    expect(mergeUploadedIds([1], [5, 5])).toEqual([5, 1]);
  });

  it("returns a copy of the existing order when nothing was uploaded", () => {
    const existing = [1, 2, 3];
    const merged = mergeUploadedIds(existing, []);
    expect(merged).toEqual([1, 2, 3]);
    expect(merged).not.toBe(existing);
  });

  it("produces exactly the union of both sets", () => {
    const merged = mergeUploadedIds([4, 5, 6], [6, 11, 12]);
    expect([...merged].sort((a, b) => a - b)).toEqual([4, 5, 6, 11, 12]);
  });
});

describe("pageCount", () => {
  it("reports one page for an empty list", () => {
    expect(pageCount(0, 20)).toBe(1);
  });

  it("does not add a page for an exactly full one", () => {
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(40, 20)).toBe(2);
  });

  it("adds a page for the remainder", () => {
    expect(pageCount(21, 20)).toBe(2);
    expect(pageCount(41, 20)).toBe(3);
  });
});

describe("pageSlice", () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1);

  it("returns the first page", () => {
    expect(pageSlice(items, 1, 20)).toEqual(items.slice(0, 20));
  });

  it("returns the short final page", () => {
    expect(pageSlice(items, 2, 20)).toEqual([21, 22, 23, 24, 25]);
  });

  it("clamps a page past the end to the last page", () => {
    expect(pageSlice(items, 99, 20)).toEqual([21, 22, 23, 24, 25]);
  });

  it("clamps a page below one to the first page", () => {
    expect(pageSlice(items, 0, 20)).toEqual(items.slice(0, 20));
  });

  it("returns nothing for an empty list", () => {
    expect(pageSlice([], 1, 20)).toEqual([]);
  });
});

describe("pageOf", () => {
  it("maps an index to the page holding it", () => {
    expect(pageOf(0, 20)).toBe(1);
    expect(pageOf(19, 20)).toBe(1);
    expect(pageOf(20, 20)).toBe(2);
    expect(pageOf(41, 20)).toBe(3);
  });

  it("clamps a negative index to the first page", () => {
    expect(pageOf(-3, 20)).toBe(1);
  });
});

describe("insertionIndexFor", () => {
  // A 2x3 grid of 100x100 tiles: two columns at x=0 and x=120, rows at
  // y=0, 120, 240. Centres are at (50,50), (170,50), (50,170) and so on.
  const grid = [
    { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 },
    { left: 120, top: 0, width: 100, height: 100, right: 220, bottom: 100 },
    { left: 0, top: 120, width: 100, height: 100, right: 100, bottom: 220 },
    { left: 120, top: 120, width: 100, height: 100, right: 220, bottom: 220 },
    { left: 0, top: 240, width: 100, height: 100, right: 100, bottom: 340 },
    { left: 120, top: 240, width: 100, height: 100, right: 220, bottom: 340 },
  ];

  it("puts a pointer before everything at the front", () => {
    expect(insertionIndexFor(grid, 10, -50)).toBe(0);
  });

  it("puts a pointer past everything at the end", () => {
    expect(insertionIndexFor(grid, 200, 500)).toBe(6);
  });

  // Within a row the answer turns on the horizontal midpoint: this is what
  // makes a tile swap with its neighbour rather than jumping a whole row.
  it("uses the horizontal midpoint within a row", () => {
    expect(insertionIndexFor(grid, 40, 50)).toBe(0);
    expect(insertionIndexFor(grid, 60, 50)).toBe(1);
    expect(insertionIndexFor(grid, 160, 50)).toBe(1);
    expect(insertionIndexFor(grid, 180, 50)).toBe(2);
  });

  // A row the pointer has passed entirely counts whatever the x is, or
  // dragging down the left-hand column could never move past a right-hand tile.
  it("counts a whole row the pointer is below", () => {
    expect(insertionIndexFor(grid, 10, 150)).toBe(2);
    expect(insertionIndexFor(grid, 10, 260)).toBe(4);
  });

  it("counts both the rows above and the tiles passed within a row", () => {
    // Two whole tiles in row one, then both of row two: the pointer is in the
    // right half of the second tile in that row, so it lands after it.
    expect(insertionIndexFor(grid, 200, 150)).toBe(4);
    // Same row, left of both midpoints: only row one counts.
    expect(insertionIndexFor(grid, 20, 150)).toBe(2);
  });

  it("returns the front for an empty grid", () => {
    expect(insertionIndexFor([], 100, 400)).toBe(0);
  });
});

describe("pendingChanges", () => {
  const baseline = [
    { id: 1, alt: "Blue cake", featured: 1 },
    { id: 2, alt: "White cake", featured: 0 },
    { id: 3, alt: "Cupcakes", featured: 0 },
  ];
  const copy = () => baseline.map((photo) => ({ ...photo }));

  it("reports nothing when nothing has been touched", () => {
    const changes = pendingChanges(baseline, copy(), new Set());
    expect(changes.count).toBe(0);
    expect(changes.orderChanged).toBe(false);
  });

  it("notices an edited description", () => {
    const photos = copy();
    photos[1].alt = "White cake with roses";
    const changes = pendingChanges(baseline, photos, new Set());
    expect(changes.alt).toEqual([2]);
    expect(changes.count).toBe(1);
  });

  it("notices a home-page toggle", () => {
    const photos = copy();
    photos[2].featured = 1;
    expect(pendingChanges(baseline, photos, new Set()).featured).toEqual([3]);
  });

  it("notices a photo marked for removal", () => {
    const changes = pendingChanges(baseline, copy(), new Set([2]));
    expect(changes.deleted).toEqual([2]);
    expect(changes.count).toBe(1);
  });

  it("notices a new order", () => {
    const photos = copy();
    photos.push(photos.shift());
    const changes = pendingChanges(baseline, photos, new Set());
    expect(changes.orderChanged).toBe(true);
  });

  // Removing a photo shifts every one after it, which must not read as a
  // reorder — otherwise a plain delete would also send an order write.
  it("does not call a removal a reorder", () => {
    const photos = copy();
    const changes = pendingChanges(baseline, photos, new Set([1]));
    expect(changes.orderChanged).toBe(false);
    expect(changes.count).toBe(1);
  });

  // Editing a photo and then removing it leaves nothing to patch: the row is
  // about to be gone, and patching it first would be a wasted write.
  it("ignores edits to a photo that is being removed", () => {
    const photos = copy();
    photos[0].alt = "Edited";
    photos[0].featured = 0;
    const changes = pendingChanges(baseline, photos, new Set([1]));
    expect(changes.alt).toEqual([]);
    expect(changes.featured).toEqual([]);
    expect(changes.deleted).toEqual([1]);
  });

  it("ignores an id that is not in the gallery", () => {
    expect(pendingChanges(baseline, copy(), new Set([99])).deleted).toEqual([]);
  });

  it("counts several kinds of change together", () => {
    const photos = copy();
    photos[0].alt = "Edited";
    photos[2].featured = 1;
    photos.push(photos.shift());
    const changes = pendingChanges(baseline, photos, new Set());
    expect(changes.count).toBe(3);
  });
});

describe("pendingChanges — the home page", () => {
  // featured carries both facts: 0 is off the home page, 1..n is the position.
  const baseline = [
    { id: 1, alt: "a", featured: 1 },
    { id: 2, alt: "b", featured: 2 },
    { id: 3, alt: "c", featured: 0 },
  ];
  const copy = () => baseline.map((photo) => ({ ...photo }));

  it("notices a photo added to the home page", () => {
    const photos = copy();
    photos[2].featured = 3;
    const changes = pendingChanges(baseline, photos, new Set());
    expect(changes.featured).toEqual([3]);
    expect(changes.featuredOrderChanged).toBe(false);
  });

  // Taking the first one off shifts everything below it, which must not read
  // as a rearrangement on top of the membership change.
  it("notices a photo taken off the home page, and calls it one change", () => {
    const photos = copy();
    photos[0].featured = 0;
    const changes = pendingChanges(baseline, photos, new Set());
    expect(changes.featured).toEqual([1]);
    expect(changes.featuredOrderChanged).toBe(false);
    expect(changes.count).toBe(1);
  });

  // Renumbering is how the order is stored, so a rearrangement changes every
  // position it touches. That is one change to report, not two memberships.
  it("calls a rearranged home page a reorder, not two membership changes", () => {
    const photos = copy();
    photos[0].featured = 2;
    photos[1].featured = 1;
    const changes = pendingChanges(baseline, photos, new Set());
    expect(changes.featured).toEqual([]);
    expect(changes.featuredOrderChanged).toBe(true);
    expect(changes.count).toBe(1);
  });

  it("reports nothing when the home page is untouched", () => {
    const changes = pendingChanges(baseline, copy(), new Set());
    expect(changes.featured).toEqual([]);
    expect(changes.featuredOrderChanged).toBe(false);
  });

  it("ignores the home page position of a photo being removed", () => {
    const changes = pendingChanges(baseline, copy(), new Set([1]));
    expect(changes.featured).toEqual([]);
    expect(changes.featuredOrderChanged).toBe(false);
    expect(changes.count).toBe(1);
  });
});

describe("describeHomeGrid", () => {
  // The bento grid is two columns on a phone and three from 900px, so six
  // fills both and seven leaves an orphan in both.
  it("says nothing when the count fills both layouts", () => {
    expect(describeHomeGrid(6)).toBe("");
    expect(describeHomeGrid(12)).toBe("");
  });

  it("warns when both layouts leave a short row", () => {
    expect(describeHomeGrid(7)).toBe(
      "The last row will be short: 1 of 3 on a computer, 1 of 2 on a phone.",
    );
  });

  it("warns about the computer only when the phone is even", () => {
    expect(describeHomeGrid(8)).toBe("The last row will be short: 2 of 3 on a computer.");
  });

  it("warns about the phone only when the computer divides evenly", () => {
    expect(describeHomeGrid(9)).toBe("The last row will be short: 1 of 2 on a phone.");
  });

  it("says nothing for an empty home page", () => {
    expect(describeHomeGrid(0)).toBe("");
  });
});
