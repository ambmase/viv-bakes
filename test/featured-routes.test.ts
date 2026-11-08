import { env, exports } from "cloudflare:workers";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ACCESS_JWT_HEADER } from "../src/auth/access";
import { createPhoto, listFeaturedPhotos, updatePhoto } from "../src/data/photos";
import type { Env } from "../src/types";

// One key pair and one fetch stub for the whole file, as in
// test/photos-routes.test.ts: `verifyAccessToken` caches its JWKS resolver per
// team domain at module scope, so a per-test key pair fails confusingly
// against the cached first one.
let originalFetch: typeof fetch;
let token: string;

const testEnv = env as unknown as Env;
const certsUrl = `${testEnv.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
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
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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

const sample = (key: string) => ({
  r2_key: `photos/${key}.webp`,
  alt: "A cake",
  width: 1200,
  height: 1200,
});

async function featuredTrio() {
  const ids: number[] = [];
  for (const key of ["a", "b", "c"]) {
    const photo = await createPhoto(db(), sample(key));
    await updatePhoto(db(), photo.id, { featured: true });
    ids.push(photo.id);
  }
  return ids;
}

function putOrder(ids: unknown) {
  return exports.default.fetch("https://example.com/api/photos/featured-order", {
    method: "PUT",
    headers: { [ACCESS_JWT_HEADER]: token, "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

const homePageIds = async () =>
  (await listFeaturedPhotos(db())).map((photo) => photo.id);

it("renumbers the home page in the order given", async () => {
  const [a, b, c] = await featuredTrio();
  const response = await putOrder([c, a, b]);

  expect(response.status).toBe(200);
  expect(await homePageIds()).toEqual([c, a, b]);
});

it("refuses a list missing one of the home-page photos", async () => {
  const [a, b] = await featuredTrio();
  expect((await putOrder([a, b])).status).toBe(400);
});

it("refuses a list with an extra id", async () => {
  const [a, b, c] = await featuredTrio();
  const other = await createPhoto(db(), sample("d"));
  expect((await putOrder([a, b, c, other.id])).status).toBe(400);
});

// The Task 3 lesson: every rejection case above also differs in length, so a
// bare size comparison would pass them all with the membership check removed.
it("refuses a list of the right length with the wrong members", async () => {
  const [a, b, c] = await featuredTrio();
  const other = await createPhoto(db(), sample("d"));

  const response = await putOrder([a, b, other.id]);

  expect(response.status).toBe(400);
  expect(await homePageIds()).toEqual([a, b, c]);
});

it("refuses a photo that is not on the home page at all", async () => {
  await featuredTrio();
  const other = await createPhoto(db(), sample("d"));
  expect((await putOrder([other.id])).status).toBe(400);
});

// Only discriminating when the set is still exactly right and it is the array
// that is too long: [a, b, b] against three photos would be refused for having
// the wrong members, leaving the duplicate check dead.
it("refuses duplicates", async () => {
  const [a, b, c] = await featuredTrio();
  await updatePhoto(db(), c, { featured: false });

  expect((await putOrder([a, b, b])).status).toBe(400);
  expect(await homePageIds()).toEqual([a, b]);
});

it("refuses a body that is not a list of integers", async () => {
  await featuredTrio();
  expect((await putOrder("nope")).status).toBe(400);
  expect((await putOrder([1.5])).status).toBe(400);
});

it("leaves the order untouched when it refuses", async () => {
  const [a, b, c] = await featuredTrio();
  await putOrder([c, b]);
  expect(await homePageIds()).toEqual([a, b, c]);
});

it("refuses an unauthenticated request", async () => {
  const [a, b, c] = await featuredTrio();
  const response = await exports.default.fetch(
    "https://example.com/api/photos/featured-order",
    { method: "PUT", body: JSON.stringify({ ids: [c, b, a] }) },
  );

  expect(response.status).toBe(401);
  expect(await homePageIds()).toEqual([a, b, c]);
});
