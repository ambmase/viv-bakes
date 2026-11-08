import { env, exports } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ACCESS_JWT_HEADER } from "../src/auth/access";
import type { Env } from "../src/types";

// As in test/api-guard.test.ts: `verifyAccessToken` caches its JWKS resolver
// per team domain at module scope, and every Worker-level test in this run
// shares the one ACCESS_TEAM_DOMAIN configured in vitest.config.ts. So this
// suite mints exactly one key pair for the whole file and stubs
// `globalThis.fetch` once, in beforeAll — not per test.
let originalFetch: typeof fetch;
let token: string;

const testEnv = env as unknown as Env;
const certsUrl = `${testEnv.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;

// Present in ADMIN_EMAILS in vitest.config.ts.
const ALLOWED_EMAIL = "admin@example.com";

const db = () => (env as unknown as { DB: D1Database }).DB;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keyPair.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url === certsUrl) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`test stub: unexpected fetch to ${url}`);
  }) as typeof fetch;

  const now = Math.floor(Date.now() / 1000);
  token = await new SignJWT({ email: ALLOWED_EMAIL })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(testEnv.ACCESS_TEAM_DOMAIN)
    .setAudience(testEnv.ACCESS_AUD)
    .setExpirationTime(now + 3600)
    .sign(keyPair.privateKey);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(async () => {
  await db().prepare("DELETE FROM photos").run();
});

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(ACCESS_JWT_HEADER, token);
  return exports.default.fetch(`https://vivianbakes.com${path}`, {
    ...init,
    headers,
  });
}

async function upload(
  alt = "A lovely cake",
  content = "webp-bytes",
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "image/webp" }), "cake.webp");
  form.append("alt", alt);
  form.append("width", "1200");
  form.append("height", "1200");
  return authed("/api/photos", { method: "POST", body: form });
}

describe("photo CRUD API", () => {
  it("uploads a photo, storing it in R2 and D1", async () => {
    const response = await upload();
    expect(response.status).toBe(201);

    const photo = (await response.json()) as { id: number; r2_key: string };
    expect(photo.r2_key).toMatch(/^photos\/[0-9a-f]{32}\.webp$/);

    const stored = await (env as unknown as { PHOTOS: R2Bucket }).PHOTOS.get(
      photo.r2_key,
    );
    expect(stored).not.toBeNull();

    const list = (await (await authed("/api/photos")).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("rejects an upload with empty alt text", async () => {
    const form = new FormData();
    form.append("file", new Blob(["bytes"], { type: "image/webp" }), "c.webp");
    form.append("alt", "");
    form.append("width", "1200");
    form.append("height", "1200");

    const response = await authed("/api/photos", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(400);
  });

  it("rejects an upload with a non-webp file", async () => {
    const form = new FormData();
    form.append("file", new Blob(["bytes"], { type: "image/jpeg" }), "c.jpg");
    form.append("alt", "A cake");
    form.append("width", "1200");
    form.append("height", "1200");

    const response = await authed("/api/photos", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(400);
  });

  it("rejects an upload with invalid dimensions", async () => {
    const form = new FormData();
    form.append("file", new Blob(["bytes"], { type: "image/webp" }), "c.webp");
    form.append("alt", "A cake");
    form.append("width", "not-a-number");
    form.append("height", "1200");

    const response = await authed("/api/photos", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(400);
  });

  it("updates alt text and the featured flag", async () => {
    const created = (await (await upload()).json()) as { id: number };

    const response = await authed(`/api/photos/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alt: "Revised text", featured: true }),
    });

    expect(response.status).toBe(200);
    const updated = (await response.json()) as {
      alt: string;
      featured: number;
    };
    expect(updated.alt).toBe("Revised text");
    expect(updated.featured).toBe(1);
  });

  it("rejects a patch that would blank the alt text", async () => {
    const created = (await (await upload()).json()) as { id: number };

    const response = await authed(`/api/photos/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alt: "   " }),
    });
    expect(response.status).toBe(400);
  });

  it("404s when patching a photo that does not exist", async () => {
    const response = await authed("/api/photos/9999", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alt: "x" }),
    });
    expect(response.status).toBe(404);
  });

  it("deletes the photo from D1 and R2", async () => {
    const created = (await (await upload()).json()) as {
      id: number;
      r2_key: string;
    };

    const response = await authed(`/api/photos/${created.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);

    const stored = await (env as unknown as { PHOTOS: R2Bucket }).PHOTOS.get(
      created.r2_key,
    );
    expect(stored).toBeNull();

    const list = (await (await authed("/api/photos")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  it("reorders photos", async () => {
    const first = (await (await upload("first", "one")).json()) as {
      id: number;
    };
    const second = (await (await upload("second", "two")).json()) as {
      id: number;
    };

    const response = await authed("/api/photos/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [second.id, first.id] }),
    });
    expect(response.status).toBe(200);

    const list = (await (await authed("/api/photos")).json()) as {
      alt: string;
    }[];
    expect(list.map((photo) => photo.alt)).toEqual(["second", "first"]);
  });

  it("rejects a reorder body that is not an array of numbers", async () => {
    const response = await authed("/api/photos/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["nope"] }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a reorder that omits an existing photo id", async () => {
    const first = (await (await upload("first", "one")).json()) as {
      id: number;
    };
    await upload("second", "two");

    const response = await authed("/api/photos/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [first.id] }),
    });
    expect(response.status).toBe(400);
  });

  // The submitted set has to match the stored one exactly, so a duplicate is
  // only caught by the duplicate check itself when the set is still right and
  // it is the array that is too long. [first, first] would be refused for
  // having the wrong members instead, and the duplicate check would be dead.
  it("rejects a reorder with a duplicate id", async () => {
    const first = (await (await upload("first", "one")).json()) as {
      id: number;
    };
    const second = (await (await upload("second", "two")).json()) as {
      id: number;
    };

    const response = await authed("/api/photos/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [first.id, second.id, second.id] }),
    });
    expect(response.status).toBe(400);

    const listed = (await (await authed("/api/photos")).json()) as {
      id: number;
    }[];
    expect(listed.map((photo) => photo.id)).toEqual([first.id, second.id]);
  });

  it("rejects a reorder with an id that does not exist", async () => {
    const first = (await (await upload("first", "one")).json()) as {
      id: number;
    };

    const response = await authed("/api/photos/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [first.id, 9999] }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a reorder of the right length but the wrong membership", async () => {
    // Every other rejection case above differs in LENGTH from the stored set,
    // so a bare size comparison would pass them all and the membership check
    // would never be exercised. Here the count matches exactly: one real id
    // swapped for a bogus one. Without the membership check this reaches
    // reorderPhotos, which renumbers only the ids it is given — leaving the
    // omitted photo at a stale sort_order that can tie with a new value and
    // make the public gallery order nondeterministic.
    const first = (await (await upload("first", "one")).json()) as {
      id: number;
    };
    await upload("second", "two");

    const response = await authed("/api/photos/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [first.id, 9999] }),
    });

    expect(response.status).toBe(400);
  });
});
