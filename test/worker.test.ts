import { exports } from "cloudflare:workers";
import { it, expect } from "vitest";

it("serves the about page from static assets", async () => {
  const response = await exports.default.fetch("https://vivianbakes.com/about.html");
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Vivian Bakes");
});

it("serves the stylesheet", async () => {
  const response = await exports.default.fetch("https://vivianbakes.com/css/style.css");
  expect(response.status).toBe(200);
});

it("serves the home page", async () => {
  const response = await exports.default.fetch("https://vivianbakes.com/index.html");
  expect(response.status).toBe(200);
});

it("serves the portfolio page", async () => {
  const response = await exports.default.fetch("https://vivianbakes.com/portfolio.html");
  expect(response.status).toBe(200);
});
