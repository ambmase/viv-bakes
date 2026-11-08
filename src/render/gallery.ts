import { listFeaturedPhotos, listPhotos } from "../data/photos";
import type { Env, Photo } from "../types";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mediaUrl(photo: Photo): string {
  return `/media/${photo.r2_key.slice("photos/".length)}`;
}

export function galleryItemHtml(photo: Photo, isFirst: boolean): string {
  const url = mediaUrl(photo);
  const alt = escapeHtml(photo.alt);
  const priority = isFirst
    ? 'fetchpriority="high"'
    : 'loading="lazy"';

  return (
    `<a href="${url}" class="glightbox gallery-item">` +
    `<img src="${url}" alt="${alt}" width="${photo.width}" height="${photo.height}" ${priority} decoding="async" />` +
    `</a>`
  );
}

export function bentoItemHtml(photo: Photo): string {
  const url = mediaUrl(photo);
  const alt = escapeHtml(photo.alt);

  return (
    `<a href="${url}" class="glightbox bento-item">` +
    `<img src="${url}" alt="${alt}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async" />` +
    `</a>`
  );
}

export function injectItems(
  response: Response,
  selector: string,
  html: string,
): Response {
  return new HTMLRewriter()
    .on(selector, {
      element(element) {
        element.setInnerContent(html, { html: true });
      },
    })
    .transform(response);
}

async function safely<T>(query: Promise<T>, fallback: T): Promise<T> {
  try {
    return await query;
  } catch (error) {
    // A database problem should not take the whole site down. Render an empty
    // grid so navigation, copy, and the contact page still work.
    console.error("gallery query failed", error);
    return fallback;
  }
}

export async function renderPortfolio(
  response: Response,
  env: Env,
): Promise<Response> {
  const photos = await safely(listPhotos(env.DB), [] as Photo[]);
  const html = photos
    .map((photo, index) => galleryItemHtml(photo, index === 0))
    .join("");
  return injectItems(response, ".gallery-grid", html);
}

export async function renderHome(
  response: Response,
  env: Env,
): Promise<Response> {
  const photos = await safely(listFeaturedPhotos(env.DB), [] as Photo[]);
  const html = photos.map(bentoItemHtml).join("");
  return injectItems(response, ".bento-grid", html);
}
