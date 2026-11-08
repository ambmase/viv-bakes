import { renderHome, renderPortfolio } from "./render/gallery";
import { handleApiRequest } from "./routes/api";
import { handleMedia } from "./routes/media";
import type { Env } from "./types";

/**
 * The URL to ask the asset service for.
 *
 * Its default `html_handling` treats the extensionless path as canonical and
 * 307-redirects `/portfolio.html` to `/portfolio`. GitHub Pages serves both
 * directly, and every link on the site — and every URL a search engine has
 * indexed, since those links are what it crawled — spells it `.html`. Passing
 * the request through unchanged makes each of those a redirect, so the asset is
 * fetched under the spelling the service does not redirect, and the page is
 * returned under the spelling that was asked for.
 *
 * `html_handling: "none"` is not the alternative: it stops `/` resolving to
 * index.html and 404s the extensionless `/about` and `/contact`, which work
 * today. This keeps both spellings answering with 200, exactly as now.
 */
function assetRequest(request: Request, pathname: string): Request {
  if (!pathname.endsWith(".html")) return request;

  const url = new URL(request.url);
  url.pathname =
    pathname === "/index.html" ? "/" : pathname.slice(0, -".html".length);
  return new Request(url, request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, pathname);
    }

    if (pathname.startsWith("/media/")) {
      return handleMedia(env, pathname);
    }

    const assetResponse = await env.ASSETS.fetch(assetRequest(request, pathname));

    if (pathname === "/" || pathname === "/index.html") {
      return renderHome(assetResponse, env);
    }
    if (pathname === "/portfolio" || pathname === "/portfolio.html") {
      return renderPortfolio(assetResponse, env);
    }

    return assetResponse;
  },
};
