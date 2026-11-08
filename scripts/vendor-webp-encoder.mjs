// Copies libwebp's WebAssembly encoder out of node_modules and into
// public/js/admin/vendor/, where the admin page loads it as a plain module.
//
// Why the page carries an encoder at all: canvas.toBlob(…, "image/webp")
// returns a PNG on iOS Safari — WebKit has no WebP encoder — and an iPhone is
// where every photo comes from. Measured on the deployed page, a 1200×1200
// photo came back as image/png at 1.9MB, which POST /api/photos refuses and
// the 3MB body cap would soon reject outright. The old code detected this
// correctly and told the user to "try Safari or Chrome", on Safari.
//
// Why vendored rather than imported: `wrangler deploy` uploads public/ exactly
// as it stands, with no bundler and no build step. Anything the page loads has
// to be sitting in public/ already.
//
// Only the non-SIMD build is vendored. The SIMD build is 62KB larger and
// produced byte-identical output in testing — 105ms against 155ms encoding a
// 1200×1200 photo. Not worth a second wasm file and a feature check.
//
//   node scripts/vendor-webp-encoder.mjs          copy, then report
//   node scripts/vendor-webp-encoder.mjs --check  verify only, change nothing
//
// --check exits 1 when a committed file differs from the installed package,
// which is what catches a hand-edited binary or a silent upstream bump.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE = "@jsquash/webp";
const SOURCE_DIR = join(process.cwd(), "node_modules", PACKAGE);
const DEST_DIR = join(process.cwd(), "public/js/admin/vendor");

// webp_enc.js resolves its own wasm with `new URL("webp_enc.wasm",
// import.meta.url)`, so the two must stay side by side under the same name.
const FILES = [
  { from: "codec/enc/webp_enc.js", to: "webp_enc.js" },
  { from: "codec/enc/webp_enc.wasm", to: "webp_enc.wasm" },
  { from: "LICENSE", to: "LICENSE" },
];

const checkOnly = process.argv.includes("--check");

if (!existsSync(SOURCE_DIR)) {
  console.error(`${PACKAGE} is not installed. Run: npm install`);
  process.exit(2);
}

const version = JSON.parse(
  readFileSync(join(SOURCE_DIR, "package.json"), "utf8"),
).version;

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

if (!checkOnly) mkdirSync(DEST_DIR, { recursive: true });

let failed = false;
const report = [];

for (const { from, to } of FILES) {
  const source = readFileSync(join(SOURCE_DIR, from));
  const destination = join(DEST_DIR, to);

  if (checkOnly) {
    if (!existsSync(destination)) {
      console.error(`FAIL  ${to}: missing from ${DEST_DIR}`);
      failed = true;
      continue;
    }
    const committed = readFileSync(destination);
    if (sha(committed) !== sha(source)) {
      console.error(
        `FAIL  ${to}: committed copy does not match ${PACKAGE}@${version}`,
      );
      failed = true;
      continue;
    }
  } else {
    writeFileSync(destination, source);
  }

  report.push(`  ${to.padEnd(16)} ${String(Math.round(source.length / 1024)).padStart(4)} KB  sha256:${sha(source).slice(0, 16)}`);
}

if (failed) {
  console.error(`\nRe-run \`node scripts/vendor-webp-encoder.mjs\` to refresh the vendored copy.`);
  process.exit(1);
}

console.log(
  `${checkOnly ? "verified" : "vendored"} libwebp encoder from ${PACKAGE}@${version}`,
);
console.log(report.join("\n"));
