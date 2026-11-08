// WebP encoding, because Safari will not do it.
//
// canvas.toBlob(…, "image/webp") does not fail on iOS Safari — it quietly
// hands back a PNG, which is what the spec says an encoder should do for a
// format it does not support. WebKit has no WebP encoder, and an iPhone is
// where every photo here comes from. Measured on the deployed page: a
// 1200×1200 photo came back as image/png at 1.9MB, refused by POST
// /api/photos, and the next one at 2.8MB was inside a hair of the 3MB body cap.
//
// So the encoder ships with the page — libwebp compiled to WebAssembly,
// vendored into vendor/ by scripts/vendor-webp-encoder.mjs.
//
// It loads on first use rather than on page load. 313KB has no business
// sitting in front of a page whose usual job is looking at a list of photos.

/** The encoder could not be loaded. Not the photo's fault — say so. */
export class EncoderUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "EncoderUnavailableError";
  }
}

// struct WebPConfig, from libwebp's encode.h. Every field has to be present:
// the binding reads them by name and throws `TypeError: Missing field` for
// any one that is absent, so this cannot be trimmed to the interesting ones.
const ENCODE_DEFAULTS = {
  quality: 75,
  target_size: 0,
  target_PSNR: 0,
  method: 4,
  sns_strength: 50,
  filter_strength: 60,
  filter_sharpness: 0,
  filter_type: 1,
  partitions: 0,
  segments: 4,
  pass: 1,
  show_compressed: 0,
  preprocessing: 0,
  autofilter: 0,
  partition_limit: 0,
  alpha_compression: 1,
  alpha_filtering: 1,
  alpha_quality: 100,
  lossless: 0,
  exact: 0,
  image_hint: 0,
  emulate_jpeg_size: 0,
  thread_level: 0,
  low_memory: 0,
  near_lossless: 100,
  use_delta_palette: 0,
  use_sharp_yuv: 0,
};

let encoderPromise = null;

/**
 * Loads the encoder once and reuses it. A failed load is not cached: a phone
 * that dropped its connection mid-download should get another go on the next
 * photo rather than being told "no encoder" for the life of the page.
 *
 * `webp_enc.js` finds its own .wasm with `new URL("webp_enc.wasm",
 * import.meta.url)`, so nothing here needs to know where the wasm lives.
 */
function loadEncoder() {
  if (!encoderPromise) {
    encoderPromise = import("./vendor/webp_enc.js")
      .then(({ default: createEncoder }) =>
        createEncoder({ noInitialRun: true }),
      )
      .catch(() => {
        encoderPromise = null;
        throw new EncoderUnavailableError(
          "the photo encoder could not be loaded — check your connection and try again",
        );
      });
  }
  return encoderPromise;
}

/**
 * Encodes raw RGBA pixels as a WebP blob.
 *
 * `pixels` is the `data` of an ImageData — four bytes per pixel, row major.
 * `quality` is the 0–1 the rest of the pipeline speaks in; libwebp wants 0–100.
 */
export async function encodeWebp(pixels, width, height, quality) {
  const encoder = await loadEncoder();

  const encoded = encoder.encode(pixels, width, height, {
    ...ENCODE_DEFAULTS,
    quality: Math.round(quality * 100),
  });

  // libwebp returns null rather than throwing when it cannot encode.
  if (!encoded) {
    throw new EncoderUnavailableError(
      "the photo could not be encoded — try a different picture",
    );
  }

  // Blob copies the bytes now, which matters: `encoded` is a view into the
  // WebAssembly heap and the next encode will write over it.
  return new Blob([encoded], { type: "image/webp" });
}
