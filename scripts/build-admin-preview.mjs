// Builds a single self-contained HTML file that runs the real admin page
// against an in-memory API, and writes it to preview/admin-preview.html.
//
// Why this exists: Cloudflare Access authenticates at the edge, so `wrangler
// dev` gets no token and /api/* returns 401 to everything. A local auth bypass
// was proposed and rejected — it reintroduces the fail-open pattern the auth
// redesign removed. So the only ways to look at this page are to deploy it, or
// this: the real app.js, list.js, drag.js and resize.js with their imports
// stripped, wired to a fake API. Resizing, WebP encoding, dragging, ordering
// and every message are the shipping code. Only the network calls and the
// image URLs are stand-ins.
//
//   node scripts/build-admin-preview.mjs
//   npx http-server preview   (or any static server)
//
// Open it on a phone over the LAN. Nothing it does touches R2 or D1.

import {
  cpSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "preview");
const MODULE_DIR = join(ROOT, "public/js/admin");

/** Strips the ESM plumbing so the modules can be concatenated into one script. */
function inlineModule(path) {
  const source = readFileSync(path, "utf8");
  return source
    .replace(/^import\s+\{[^}]*\}\s+from\s+"[^"]+";\s*$/gm, "")
    .replace(/^export /gm, "");
}

// Every module is picked up from the directory rather than listed by hand:
// naming them by hand once produced a preview whose resizeToWebp did not
// exist, and picked files sat on "Getting it ready…" for ever.
const moduleFiles = readdirSync(MODULE_DIR)
  .filter((name) => name.endsWith(".js") && name !== "api.js" && name !== "app.js")
  .sort();
moduleFiles.push("app.js"); // last: it runs on load and needs the rest defined.
let modules = moduleFiles
  .map((name) => inlineModule(join(MODULE_DIR, name)))
  .join("\n");

// The one substitution besides the API: photos are embedded in the file rather
// than streamed from R2, so /media/<key> would 404 for every tile.
const realMediaUrl = `function mediaUrl(photo) {
  return \`/media/\${photo.r2_key.slice("photos/".length)}\`;
}`;
if (!modules.includes(realMediaUrl)) {
  throw new Error("mediaUrl in app.js no longer matches — update this script");
}
modules = modules.replace(
  realMediaUrl,
  `function mediaUrl(photo) {
  return MOCK_MEDIA.get(photo.r2_key) ?? "";
}`,
);

// Photos come from the markup the site ships today, so the preview shows the
// real gallery with its real descriptions.
const portfolio = readFileSync(join(ROOT, "public/portfolio.html"), "utf8");
const home = readFileSync(join(ROOT, "public/index.html"), "utf8");
const featured = new Set(
  [...home.slice(home.indexOf("bento-grid")).matchAll(/images\/([\w.-]+\.webp)/g)].map(
    (match) => match[1],
  ),
);

const gallery = portfolio.slice(portfolio.indexOf('class="gallery-grid"'));
let homePosition = 0;
const rows = [...gallery.matchAll(
  /<img src="images\/([^"]+)" alt="([^"]*)" width="(\d+)" height="(\d+)"/g,
)].map((match, index) => {
  const [, file, alt, width, height] = match;
  const onHomePage = featured.has(file);
  if (onHomePage) homePosition += 1;
  const bytes = readFileSync(join(ROOT, "public/images", file)).toString("base64");
  return {
    id: index + 1,
    r2_key: `photos/${file}`,
    alt,
    width: Number(width),
    height: Number(height),
    sort_order: index + 1,
    // `featured` carries the position: 0 is off the home page.
    featured: onHomePage ? homePosition : 0,
    src: `data:image/webp;base64,${bytes}`,
  };
});

const media = rows.map((row) => `  ["${row.r2_key}", "${row.src}"]`).join(",\n");
const seed = JSON.stringify(
  rows.map(({ src, ...row }) => row),
  null,
  1,
);

const fakeApi = `
const MOCK_MEDIA = new Map([
${media}
]);

let MOCK_ROWS = ${seed};
let nextId = 1000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getMe() { await wait(120); return { email: "viv@example.com" }; }
async function listPhotos() { await wait(120); return MOCK_ROWS.map((row) => ({ ...row })); }

async function uploadPhoto({ blob, alt, width, height }) {
  await wait(500);
  // Real keys are content hashes, which is what makes a re-upload idempotent.
  //
  // Not SHA-256 though: crypto.subtle exists only in a secure context, and
  // this preview is served over plain http on a LAN address so a phone can
  // reach it at all. On iOS Safari that made every upload die with "undefined
  // is not an object (evaluating 'crypto.subtle.digest')". The real hash is a
  // SHA-256 in the Worker (src/storage/photos.ts); this one only has to be
  // deterministic, so FNV-1a over the bytes is plenty.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    b = Math.imul(b + bytes[i], 0x85ebca6b) >>> 0;
  }
  const key = "photos/" +
    a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  const existing = MOCK_ROWS.find((row) => row.r2_key === key);
  if (existing) { existing.alt = alt; return { ...existing }; }
  MOCK_MEDIA.set(key, URL.createObjectURL(blob));
  const row = { id: ++nextId, r2_key: key, alt, width, height,
                sort_order: MOCK_ROWS.length + 1, featured: 0 };
  MOCK_ROWS.push(row);
  return { ...row };
}

async function patchPhoto(id, fields) {
  await wait(200);
  const row = MOCK_ROWS.find((candidate) => candidate.id === id);
  if (fields.alt !== undefined) row.alt = fields.alt;
  if (fields.featured !== undefined) {
    // Appended to the end of the home page, or cleared — as the server does.
    row.featured = fields.featured
      ? (row.featured > 0
          ? row.featured
          : Math.max(0, ...MOCK_ROWS.map((candidate) => candidate.featured)) + 1)
      : 0;
  }
  return { ...row };
}

async function deletePhoto(id) {
  await wait(200);
  MOCK_ROWS = MOCK_ROWS.filter((row) => row.id !== id);
  return { ok: true };
}

function requireExactly(ids, current) {
  const submitted = new Set(ids);
  if (submitted.size !== ids.length || submitted.size !== current.size ||
      ![...submitted].every((id) => current.has(id))) {
    throw new Error("ids must match the current set exactly");
  }
}

async function reorderPhotos(ids) {
  await wait(250);
  requireExactly(ids, new Set(MOCK_ROWS.map((row) => row.id)));
  MOCK_ROWS.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
  MOCK_ROWS.forEach((row, index) => { row.sort_order = index + 1; });
  return { ok: true };
}

async function reorderFeatured(ids) {
  await wait(250);
  requireExactly(ids, new Set(MOCK_ROWS.filter((row) => row.featured > 0).map((row) => row.id)));
  ids.forEach((id, index) => {
    MOCK_ROWS.find((row) => row.id === id).featured = index + 1;
  });
  return { ok: true };
}
`;

const adminHtml = readFileSync(join(ROOT, "public/admin.html"), "utf8");
let body = adminHtml.split("<body>")[1].split("</body>")[0];
body = body
  .replace(
    '<a href="/cdn-cgi/access/logout" class="admin-signout">Sign out</a>',
    '<a href="#" class="admin-signout">Sign out</a>',
  )
  // "/" is the preview itself here, so the link would silently reload the page
  // and look broken rather than inert.
  .replace('<a href="/" class="admin-back">', '<a href="#" class="admin-back">')
  .replace('  <script type="module" src="js/admin/app.js"></script>\n', "")
  .replace(
    '<main id="content" class="admin-page">',
    '<main id="content" class="admin-page">\n\n    <p class="preview-banner">Practice copy — real page, fake data. ' +
      "Nothing here is saved, and no photo you add reaches the website.</p>",
  );

const css = readFileSync(join(ROOT, "public/css/style.css"), "utf8");

// A whole document, unlike the artifact build: served raw there is no wrapper
// to supply a charset or a viewport, and without them a phone renders this at
// 980px with every accented character broken.
const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Manage Portfolio — preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,WONK@0,9..144,400;0,9..144,700;1,9..144,400&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
${css}
.preview-banner {
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--color-text-muted);
  background: var(--color-gold-light);
  border: 1px dashed var(--color-gold);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  margin-bottom: 20px;
}
</style>
</head>
<body>
${body}
<script type="module">
${fakeApi}
${modules}
</script>
</body>
</html>
`;

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, "index.html");
writeFileSync(out, page);

// webp.js reaches its encoder with a dynamic import, which the inlining above
// deliberately leaves alone. In the real page that resolves against
// /js/admin/; here it resolves against the preview document, so the encoder
// has to sit next to it or every photo fails at the encode step.
cpSync(join(MODULE_DIR, "vendor"), join(OUT_DIR, "vendor"), { recursive: true });

// A definition that goes missing turns into a silent stall rather than an
// error, so check the ones the page cannot work without.
for (const name of ["pageCount", "insertionIndexFor", "resizeToWebp",
                    "encodeWebp", "enableDragReorder", "pendingChanges",
                    "describeHomeGrid"]) {
  if (!new RegExp(`^(?:async )?(?:function|class|const) ${name}\\b`, "m").test(modules)) {
    throw new Error(`preview is missing ${name} — check the module list`);
  }
}

console.log(
  `${out}\n${rows.length} photos, ${moduleFiles.join(", ")}, ${(page.length / 1024 / 1024).toFixed(1)} MB`,
);
