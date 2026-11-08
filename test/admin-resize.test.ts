import { describe, expect, it } from "vitest";
import { fitWithin } from "../public/js/admin/resize.js";

describe("fitWithin", () => {
  it("scales a landscape photo to the long edge", () => {
    expect(fitWithin(3000, 2000, 1200)).toEqual({ width: 1200, height: 800 });
  });

  it("scales a portrait photo to the long edge", () => {
    expect(fitWithin(2000, 3000, 1200)).toEqual({ width: 800, height: 1200 });
  });

  it("scales a square photo", () => {
    expect(fitWithin(4000, 4000, 1200)).toEqual({ width: 1200, height: 1200 });
  });

  // Upscaling a small photo would inflate the upload and invent detail that
  // is not in the original.
  it("leaves a photo smaller than the limit alone", () => {
    expect(fitWithin(800, 600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it("leaves a photo exactly at the limit alone", () => {
    expect(fitWithin(1200, 900, 1200)).toEqual({ width: 1200, height: 900 });
  });

  it("rounds the short edge to a whole pixel", () => {
    expect(fitWithin(3000, 1001, 1200)).toEqual({ width: 1200, height: 400 });
  });

  // A canvas of zero width or height throws, so a very thin panorama must
  // still resolve to at least one pixel on its short edge.
  it("never rounds the short edge down to zero", () => {
    expect(fitWithin(3000, 1, 1200)).toEqual({ width: 1200, height: 1 });
  });
});
