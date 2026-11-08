// Every class the admin page and its scripts use must have a rule in
// style.css. A restore-and-reapply once dropped the reorder bar's styles
// silently, and the page still "worked" — it just had an unstyled bar sitting
// off the bottom of a three-screen list.
import { readFileSync } from "node:fs";

const css = readFileSync("public/css/style.css", "utf8");
const sources = [
  "public/admin.html",
  "public/js/admin/app.js",
  "public/js/admin/drag.js",
].map((path) => readFileSync(path, "utf8")).join("\n");

const used = new Set();
for (const [, value] of sources.matchAll(/class(?:Name)?="([^"]+)"/g)) {
  for (const name of value.split(/\s+/)) used.add(name);
}
for (const [, value] of sources.matchAll(/className = `?([a-z0-9 -]+)`?/gi)) {
  for (const name of value.split(/\s+/)) used.add(name);
}
for (const [, value] of sources.matchAll(/classList\.(?:add|toggle)\("([^"]+)"/g)) {
  used.add(value);
}

const ignore = new Set(["btn", "skip-link", "section-title", "admin-page", ""]);
const missing = [...used]
  .filter((name) => !ignore.has(name) && !name.startsWith("$"))
  .filter((name) => !new RegExp(`\\.${name}[\\s,:.{)]`).test(css));

if (missing.length > 0) {
  console.error("Classes used by the admin page with no rule in style.css:");
  for (const name of missing) console.error(`  .${name}`);
  process.exit(1);
}
console.log(`verified ${used.size} admin classes against style.css`);
