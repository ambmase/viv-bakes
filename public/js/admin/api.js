// API client for the admin page. Cloudflare Access has already authenticated
// and authorised the visitor by the time this runs — there is no login,
// logout, or session-check here. A 401 from any request means the Access
// session has expired; the caller should reload the page and let Access
// re-authenticate.

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
  });

  if (response.status === 401) {
    throw new Error("unauthorized");
  }

  if (response.status === 204) {
    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }
    return null;
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      body && typeof body.error === "string"
        ? body.error
        : `request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body;
}

export function getMe() {
  return request("/api/me");
}

export function listPhotos() {
  return request("/api/photos");
}

export function uploadPhoto({ blob, alt, width, height }) {
  const form = new FormData();
  form.set("file", blob, "photo.webp");
  form.set("alt", alt);
  form.set("width", String(width));
  form.set("height", String(height));

  return request("/api/photos", {
    method: "POST",
    body: form,
  });
}

export function patchPhoto(id, fields) {
  return request(`/api/photos/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}

export function deletePhoto(id) {
  return request(`/api/photos/${id}`, {
    method: "DELETE",
  });
}

export function reorderFeatured(ids) {
  return request("/api/photos/featured-order", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

export function reorderPhotos(ids) {
  return request("/api/photos/order", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}
