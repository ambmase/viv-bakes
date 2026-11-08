// Checks what every URL on the site actually returns.
//
// This exists because the test suite structurally cannot: the Workers test pool
// serves assets without `html_handling`, so `/portfolio.html` returns 200 there
// no matter what the deployed configuration does. A test asserting "200, not a
// redirect" would pass whether or not the redirect was fixed. Only a real
// server — `wrangler dev` or the deployed Worker — applies the rule.
//
// Usage:
//   npm run verify:routes                      spawns wrangler dev and checks it
//   node scripts/verify-routes.mjs --url https://vivianbakes.com
//   ... --expect-admin-protected               /admin* must NOT be reachable
//
// The last form is the post-cutover check: public pages answer directly, the
// gallery is really coming from D1, and the admin is behind Access.
//
// Exit codes: 0 all as expected, 1 something is wrong, 2 the server never came up.

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const urlArg = args.indexOf("--url");
const adminProtected = args.includes("--expect-admin-protected");
const PORT = 8788;
const base = urlArg === -1 ? `http://127.0.0.1:${PORT}` : args[urlArg + 1];
const spawnServer = urlArg === -1;

// Every page, in both spellings. GitHub Pages serves both with a 200 today, and
// every link on the site and in search results uses .html, so a redirect on
// either spelling is a behaviour change on URLs that are already out there.
const PAGES = [
  "/",
  "/index.html",
  "/portfolio",
  "/portfolio.html",
  "/about",
  "/about.html",
  "/contact",
  "/contact.html",
];
const ASSETS = ["/robots.txt", "/favicon.svg", "/css/style.css"];
const ADMIN = ["/admin", "/admin.html"];
// The gallery must come from D1, not from markup: these pages should carry
// /media/ URLs and never the placeholder comment left in the HTML.
const INJECTED = ["/", "/index.html", "/portfolio", "/portfolio.html"];

const failures = [];
const lines = [];

function check(ok, path, detail) {
  lines.push(`${ok ? "OK  " : "FAIL"}  ${path.padEnd(18)} ${detail}`);
  if (!ok) failures.push(path);
}

async function head(path) {
  const response = await fetch(`${base}${path}`, { redirect: "manual" });
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    body: response.status === 200 ? await response.text() : "",
  };
}

let server;
if (spawnServer) {
  server = spawn("npx", ["wrangler", "dev", "--port", String(PORT)], {
    stdio: "ignore",
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`${base}/robots.txt`);
      break;
    } catch {
      if (Date.now() > deadline) {
        server.kill();
        console.error("wrangler dev did not start within 60s.");
        process.exit(2);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

try {
  for (const path of [...PAGES, ...ASSETS]) {
    const { status, location } = await head(path);
    if (status === 200) check(true, path, "200");
    else if (status >= 300 && status < 400) {
      check(false, path, `${status} redirect to ${location} — should answer directly`);
    } else check(false, path, `${status}`);
  }

  for (const path of ADMIN) {
    const { status, location } = await head(path);
    if (adminProtected) {
      const gated = status >= 300 && status < 400 && !location.startsWith(base);
      check(gated, path, gated ? `${status} to ${new URL(location).host} — behind Access` : `${status} ${location} — NOT protected`);
    } else {
      check(status === 200, path, status === 200 ? "200" : `${status} ${location}`);
    }
  }

  for (const path of INJECTED) {
    const { status, body } = await head(path);
    if (status !== 200) {
      check(false, path, `${status} — cannot check injection`);
      continue;
    }
    const placeholder = body.includes("injected at the edge");
    const items = (body.match(/\/media\/[0-9a-f]{32}\.webp/g) ?? []).length;
    check(
      !placeholder && items > 0,
      path,
      placeholder
        ? "placeholder comment still served — injection did not run"
        : items === 0
          ? "no /media/ photos — the grid rendered empty"
          : `${items} photo references from D1`,
    );
  }

  const missing = await head("/no-such-page");
  check(missing.status === 404, "/no-such-page", `${missing.status} (expected 404)`);
} finally {
  server?.kill();
}

console.log(`Checked ${base}\n`);
for (const line of lines) console.log(line);

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s): ${[...new Set(failures)].join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${lines.length} checks passed.`);
