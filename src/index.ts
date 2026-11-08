import { renderHome, renderPortfolio } from "./render/gallery";
import { handleApiRequest } from "./routes/api";
import { handleMedia } from "./routes/media";
import type { Env } from "./types";

/**
 * Where a `.html` URL lives now, or `null` if it is not one.
 *
 * The site's canonical addresses are extensionless: `/portfolio`, not
 * `/portfolio.html`. GitHub Pages served the `.html` spellings for years, so
 * those are the URLs search engines indexed and people bookmarked. Each one gets
 * a permanent redirect, which keeps the bookmark working and tells a search
 * engine to move the page's ranking to the new address.
 *
 * It has to be 301. The asset service would redirect these by itself, but with
 * a 307 — temporary — which tells a search engine to keep the old address.
 */
function cleanPath(pathname: string): string | null {
  if (!pathname.endsWith(".html")) return null;
  return pathname === "/index.html" ? "/" : pathname.slice(0, -".html".length);
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

    const clean = cleanPath(pathname);
    if (clean !== null) {
      const url = new URL(request.url);
      url.pathname = clean;
      return Response.redirect(url.toString(), 301);
    }

    const assetResponse = await env.ASSETS.fetch(request);

    if (pathname === "/") {
      return renderHome(assetResponse, env);
    }
    if (pathname === "/portfolio") {
      return renderPortfolio(assetResponse, env);
    }

    return assetResponse;
  },
};
