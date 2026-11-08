import { exports } from "cloudflare:workers";
import { it, expect } from "vitest";

it("serves the about page from static assets", async () => {
  const response = await exports.default.fetch("https://vivianbakes.com/about");
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Vivian Bakes");
});

it("serves the stylesheet", async () => {
  const response = await exports.default.fetch("https://vivianbakes.com/css/style.css");
  expect(response.status).toBe(200);
});

it("serves the home page", async () => {
  const response = await exports.default.fetch("https://vivianbakes.com/");
  expect(response.status).toBe(200);
});

it("serves the portfolio page", async () => {
  const response = await exports.default.fetch("https://vivianbakes.com/portfolio");
  expect(response.status).toBe(200);
});

// The .html spellings are what GitHub Pages served and what search engines
// indexed. They must redirect permanently — a 307 would tell a search engine
// to keep the old address — and to the right page.
it.each([
  ["/index.html", "/"],
  ["/portfolio.html", "/portfolio"],
  ["/about.html", "/about"],
  ["/contact.html", "/contact"],
  ["/admin.html", "/admin"],
])("permanently redirects %s to %s", async (from, to) => {
  const response = await exports.default.fetch(`https://vivianbakes.com${from}`, {
    redirect: "manual",
  });
  expect(response.status).toBe(301);
  expect(response.headers.get("location")).toBe(`https://vivianbakes.com${to}`);
});

it("keeps the query string when redirecting", async () => {
  const response = await exports.default.fetch(
    "https://vivianbakes.com/portfolio.html?utm_source=instagram",
    { redirect: "manual" },
  );
  expect(response.headers.get("location")).toBe(
    "https://vivianbakes.com/portfolio?utm_source=instagram",
  );
});
