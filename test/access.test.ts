import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ACCESS_JWT_HEADER, verifyAccessToken } from "../src/auth/access";
import type { Env } from "../src/types";

// Each test gets its own team domain so its own generated key pair is what
// the JWKS resolver actually fetches — jose caches a resolved JWKS per
// `createRemoteJWKSet` instance (keyed by domain in src/auth/access.ts), so
// reusing one domain across tests would risk a later test silently matching
// against an earlier test's cached key.
let domainCounter = 0;

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

interface AccessFixture {
  env: Env;
  keyPair: KeyPair;
  mint: (overrides?: {
    email?: string;
    iss?: string;
    aud?: string;
    exp?: number;
    key?: KeyPair;
  }) => Promise<string>;
}

/**
 * Stands up one isolated Access "team": a fresh RSA key pair, a fake JWKS
 * endpoint serving its public half, and an Env pointed at both. Returns a
 * `mint` helper so each test case can produce a token in one line, only
 * overriding the claim(s) it cares about.
 */
async function setupAccess(
  envOverrides: Partial<Env> = {},
): Promise<AccessFixture> {
  domainCounter += 1;
  const teamDomain = `https://test-team-${domainCounter}.cloudflareaccess.com`;
  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;

  const keyPair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keyPair.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

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

  const testEnv: Env = {
    ...(env as unknown as Env),
    ACCESS_TEAM_DOMAIN: teamDomain,
    ACCESS_AUD: "test-audience",
    ADMIN_EMAILS: "alice@example.com, bob@example.com",
    ...envOverrides,
  };

  const mint: AccessFixture["mint"] = async (overrides = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const pair = overrides.key ?? keyPair;
    return new SignJWT({ email: overrides.email ?? "alice@example.com" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt()
      .setIssuer(overrides.iss ?? testEnv.ACCESS_TEAM_DOMAIN)
      .setAudience(overrides.aud ?? testEnv.ACCESS_AUD)
      .setExpirationTime(overrides.exp ?? now + 3600)
      .sign(pair.privateKey);
  };

  return { env: testEnv, keyPair, mint };
}

function requestWith(token?: string): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set(ACCESS_JWT_HEADER, token);
  return new Request("https://vivianbakes.com/api/photos", { headers });
}

describe("verifyAccessToken", () => {
  it("returns the identity for a valid, allow-listed token", async () => {
    const { env, mint } = await setupAccess();
    const token = await mint({ email: "alice@example.com" });

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toEqual({ email: "alice@example.com" });
  });

  it("rejects a token signed with a different key pair", async () => {
    const { env, mint } = await setupAccess();
    const impostorKeyPair = await generateKeyPair("RS256");
    const token = await mint({ key: impostorKeyPair });

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { env, mint } = await setupAccess();
    const now = Math.floor(Date.now() / 1000);
    const token = await mint({ exp: now - 3600 });

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toBeNull();
  });

  it("rejects a token with the wrong audience", async () => {
    const { env, mint } = await setupAccess();
    const token = await mint({ aud: "some-other-application" });

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toBeNull();
  });

  it("rejects a token with the wrong issuer", async () => {
    const { env, mint } = await setupAccess();
    const token = await mint({
      iss: "https://a-different-team.cloudflareaccess.com",
    });

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toBeNull();
  });

  it("rejects a request with no Cf-Access-Jwt-Assertion header", async () => {
    const { env } = await setupAccess();

    const identity = await verifyAccessToken(requestWith(undefined), env);

    expect(identity).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const { env } = await setupAccess();

    const identity = await verifyAccessToken(
      requestWith("not.a.jwt"),
      env,
    );

    expect(identity).toBeNull();
  });

  it("rejects a correctly signed token for a non-allow-listed email", async () => {
    const { env, mint } = await setupAccess();
    // Identical signing key, iss, aud, and exp to the "valid token" case
    // above — only the email differs. If this fails for any reason other
    // than the allow-list check, the "valid" test above would fail too.
    const token = await mint({ email: "eve@not-allowed.example.com" });

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toBeNull();
  });

  it("matches the allow-list case-insensitively and ignoring whitespace", async () => {
    const { env, mint } = await setupAccess({
      ADMIN_EMAILS: "  Alice@Example.com ,BOB@EXAMPLE.COM  ",
    });
    const token = await mint({ email: "alice@example.com" });

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toEqual({ email: "alice@example.com" });
  });

  it("rejects a token that carries no exp claim", async () => {
    // jose does not require `exp` by default, so without requiredClaims a
    // token with no expiry verifies and stays valid forever.
    const { env, keyPair } = await setupAccess();
    const token = await new SignJWT({ email: "alice@example.com" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt()
      .setIssuer(env.ACCESS_TEAM_DOMAIN)
      .setAudience(env.ACCESS_AUD)
      .sign(keyPair.privateKey); // no setExpirationTime

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toBeNull();
  });

  it("does not let Unicode case folding match the allow-list", async () => {
    // U+212A (Kelvin sign) lowercases to "k" under full Unicode case folding,
    // so String.toLowerCase() would treat this address as "mike@example.com".
    const { env, mint } = await setupAccess({
      ADMIN_EMAILS: "mike@example.com",
    });
    const token = await mint({ email: "miKe@example.com" });

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toBeNull();
  });

  // No test covers the `algorithms: ["RS256"]` pin in src/auth/access.ts, and
  // that is deliberate. jose selects JWKS keys by their `alg` field, and Access
  // publishes RS256 keys, so a token using any other algorithm fails key
  // resolution before the pin is consulted. Demonstrating the pin would need a
  // JWKS that Cloudflare never serves. The pin stays as defence against a
  // future library default changing; it is documented rather than tested.
  it("fails closed when ACCESS_AUD is empty, even for an otherwise valid token", async () => {
    const { env, mint } = await setupAccess({ ACCESS_AUD: "" });
    const token = await mint();

    const identity = await verifyAccessToken(requestWith(token), env);

    expect(identity).toBeNull();
  });
});
