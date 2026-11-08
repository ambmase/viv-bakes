import { env, exports } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ACCESS_JWT_HEADER } from "../src/auth/access";
import type { Env } from "../src/types";

// `verifyAccessToken` caches its JWKS resolver per team domain at module
// scope (see src/auth/access.ts), and every Worker-level test in this file
// shares the one ACCESS_TEAM_DOMAIN configured in vitest.config.ts. So this
// suite mints exactly one key pair for the whole file and stubs
// `globalThis.fetch` once, in beforeAll — not per test. Generating a key per
// test would still leave the cached resolver holding the first test's key,
// and later tests would fail confusingly against a stale key.
let originalFetch: typeof fetch;
let mint: (overrides?: { email?: string }) => Promise<string>;

const testEnv = env as unknown as Env;
const certsUrl = `${testEnv.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;

// Present in ADMIN_EMAILS in vitest.config.ts.
const ALLOWED_EMAIL = "admin@example.com";
const DISALLOWED_EMAIL = "eve@not-allowed.example.com";

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

  mint = async (overrides = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email: overrides.email ?? ALLOWED_EMAIL })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt()
      .setIssuer(testEnv.ACCESS_TEAM_DOMAIN)
      .setAudience(testEnv.ACCESS_AUD)
      .setExpirationTime(now + 3600)
      .sign(keyPair.privateKey);
  };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(`https://vivianbakes.com${path}`, init);
}

async function authedInit(token: string, init: RequestInit = {}): Promise<RequestInit> {
  const headers = new Headers(init.headers);
  headers.set(ACCESS_JWT_HEADER, token);
  return { ...init, headers };
}

describe("/api/* guard", () => {
  it("returns 401 with no token, and the body does not reveal the reason", async () => {
    const response = await fetchApi("/api/photos");

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "unauthorized" });
  });

  it.each([
    ["POST", "/api/photos"],
    ["PUT", "/api/photos/order"],
    ["PATCH", "/api/photos/1"],
    ["DELETE", "/api/photos/1"],
  ])("returns 401 for %s %s with no token", async (method, path) => {
    const response = await fetchApi(path, { method });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for an unrecognised path with no token (deny by default)", async () => {
    const response = await fetchApi("/api/nonsense");

    expect(response.status).toBe(401);
  });

  it("returns 404 (not 401) for an unrecognised path with a valid token", async () => {
    const token = await mint();
    const response = await fetchApi(
      "/api/nonsense",
      await authedInit(token),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "not found" });
  });

  it("returns 401 for a token with a non-allow-listed email", async () => {
    const token = await mint({ email: DISALLOWED_EMAIL });
    const response = await fetchApi(
      "/api/photos",
      await authedInit(token),
    );

    expect(response.status).toBe(401);
  });

  it("returns 200 and the signed-in email for GET /api/me with a valid token", async () => {
    const token = await mint();
    const response = await fetchApi("/api/me", await authedInit(token));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ email: ALLOWED_EMAIL });
  });

  it("leaves /media/* and static pages public and reachable without a token", async () => {
    const mediaResponse = await fetchApi(
      "/media/0123456789abcdef0123456789abcdef.webp",
    );
    // Not gated by the guard: a 404 (object does not exist) rather than 401
    // (unauthorized) proves the guard never ran on this path.
    expect(mediaResponse.status).toBe(404);

    const pageResponse = await fetchApi("/about");
    expect(pageResponse.status).toBe(200);
  });
});
