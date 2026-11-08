// Verifies that every resource identifier in wrangler.jsonc actually matches a
// resource on the Cloudflare account.
//
// This exists because a wrong database_id is invisible to the test suite: local
// D1 never validates the id, so the whole suite passes against a config that
// fails only at deploy. Anything hand-copied from command output — a database
// id, a bucket name — needs checking against the authoritative source.
//
// Usage: npm run verify:bindings
//
// Exit codes: 0 all good, 1 a mismatch, 2 could not check (not authenticated).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONFIG = "wrangler.jsonc";

// Strip // and /* */ comments without corrupting strings that contain those
// characters. JSON.parse cannot do this itself and wrangler.jsonc permits both.
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (char === "\n") {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[++i] ?? "";
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += char;
  }

  return out;
}

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const results = [];
let failed = false;

function record(ok, label, detail) {
  results.push({ ok, label, detail });
  if (!ok) failed = true;
}

const config = JSON.parse(stripJsonComments(readFileSync(CONFIG, "utf8")));

// --- D1: the id must match the database of that name on the account ---------

const databases = config.d1_databases ?? [];

if (databases.length > 0) {
  let listed;
  try {
    listed = JSON.parse(wrangler(["d1", "list", "--json"]));
  } catch (error) {
    console.error("Could not list D1 databases. Are you logged in?");
    console.error("Run: npx wrangler login");
    process.exit(2);
  }

  for (const database of databases) {
    const match = listed.find((row) => row.name === database.database_name);

    if (!match) {
      record(
        false,
        `D1 "${database.database_name}"`,
        `no database of that name exists on the account`,
      );
    } else if (match.uuid !== database.database_id) {
      record(
        false,
        `D1 "${database.database_name}"`,
        `${CONFIG} says ${database.database_id}, Cloudflare says ${match.uuid}`,
      );
    } else {
      record(true, `D1 "${database.database_name}"`, match.uuid);
    }
  }
}

// --- R2: buckets are named, not id'd, so existence is the whole check -------

for (const bucket of config.r2_buckets ?? []) {
  try {
    wrangler(["r2", "bucket", "info", bucket.bucket_name]);
    record(true, `R2 "${bucket.bucket_name}"`, "exists");
  } catch {
    record(
      false,
      `R2 "${bucket.bucket_name}"`,
      "no bucket of that name exists on the account",
    );
  }
}

// --- Report -----------------------------------------------------------------

if (results.length === 0) {
  console.log(`No D1 or R2 bindings declared in ${CONFIG} yet — nothing to check.`);
  process.exit(0);
}

for (const { ok, label, detail } of results) {
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}: ${detail}`);
}

if (failed) {
  console.error(`\n${CONFIG} does not match the Cloudflare account.`);
  console.error("Fix the identifier in the config rather than creating a new resource.");
  process.exit(1);
}

console.log(`\nAll ${results.length} binding(s) match the Cloudflare account.`);
