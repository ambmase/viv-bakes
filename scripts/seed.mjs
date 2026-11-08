// Migrates the twenty photos that are hardcoded in the site's markup today into
// R2 and D1, so the admin becomes the only place they are edited.
//
// The markup is the source of truth for order and alt text, deliberately: it is
// what visitors see right now, and the migration is only honest if the gallery
// comes out the other side identical. Every decision it makes is a tested pure
// function in seed-plan.mjs; this file reads files and calls wrangler.
//
// Usage:
//   npm run seed:local     — into the .wrangler state that `wrangler dev` uses
//   npm run seed:remote    — into the real database and bucket. Ask first.
//   node scripts/seed.mjs --dry-run   — print the plan, touch nothing
//
// Safe to re-run: object keys are content hashes and the insert is
// ON CONFLICT DO NOTHING, so a second run against the same files is a no-op.
//
// Exit codes: 0 seeded, 1 the markup or the files are not what was expected.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildRows, parseGrid, photoKey, toSql, webpSize } from "./seed-plan.mjs";

const remote = process.argv.includes("--remote");
const dryRun = process.argv.includes("--dry-run");
const scope = remote ? "--remote" : "--local";

const BUCKET = "vivbakes-photos";
const DATABASE = "vivbakes";
const IMAGES = "public/images";
const SQL_PATH = "scripts/seed.generated.sql";
// Matches putPhotoObject in src/storage/photos.ts, so a seeded object and an
// uploaded one are indistinguishable.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

function wrangler(args) {
  execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// --- Read the pages and the files they point at -----------------------------

let gallery;
let home;
try {
  gallery = parseGrid(readFileSync("public/portfolio.html", "utf8"), "gallery-grid");
  home = parseGrid(readFileSync("public/index.html", "utf8"), "bento-grid");
} catch (error) {
  fail(`${error.message}\nNothing was written.`);
}

const bytesOf = new Map();
for (const item of gallery) {
  const file = path.join(IMAGES, item.file);
  try {
    bytesOf.set(item.file, readFileSync(file));
  } catch {
    fail(`${file} is referenced by the gallery but is not on disk.`);
  }
}

let rows;
try {
  rows = buildRows({
    gallery,
    home,
    sizeOf: (file) => webpSize(bytesOf.get(file)),
  });
} catch (error) {
  fail(`${error.message}\nNothing was written.`);
}

for (const row of rows) {
  row.key = await photoKey(bytesOf.get(row.file));
}

// --- Show the whole plan before any of it happens ---------------------------

console.log(
  `${rows.length} photos, ${rows.filter((row) => row.featured > 0).length} of them on the home page.\n`,
);
for (const row of rows) {
  const slot = row.featured > 0 ? `home ${row.featured}` : "—";
  console.log(
    `${String(row.sortOrder).padStart(2)}  ${slot.padEnd(7)}  ` +
      `${row.width}x${row.height}  ${row.file}\n    ${row.alt}`,
  );
}

if (dryRun) {
  console.log("\n--dry-run: nothing was written.");
  process.exit(0);
}

console.log(
  `\nWriting to the ${remote ? "REMOTE (production)" : "local"} bucket and database.\n`,
);

// --- Upload, then insert ----------------------------------------------------

for (const row of rows) {
  console.log(`[${row.sortOrder}/${rows.length}] ${row.file} -> ${row.key}`);
  wrangler([
    "r2",
    "object",
    "put",
    `${BUCKET}/${row.key}`,
    `--file=${path.join(IMAGES, row.file)}`,
    "--content-type=image/webp",
    `--cache-control=${CACHE_CONTROL}`,
    scope,
  ]);
}

writeFileSync(SQL_PATH, toSql(rows));
console.log(`\nWrote ${SQL_PATH}`);

wrangler(["d1", "execute", DATABASE, `--file=${SQL_PATH}`, scope, "--yes"]);

console.log("\nSeed complete.");
