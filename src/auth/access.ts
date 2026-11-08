import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../types";

/**
 * Cloudflare Access JWT verification.
 *
 * This is defence in depth: Access is supposed to block unauthorised
 * requests at the edge before the Worker ever runs, so in normal operation
 * this check never fires. It exists for the case where an Access
 * application is misconfigured, deleted, or a hostname is left uncovered —
 * then this is the only thing protecting the photo API. Treat every branch
 * here as a security boundary, not a formality.
 */

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

export interface AccessIdentity {
  email: string;
}

type RemoteJwkSet = ReturnType<typeof createRemoteJWKSet>;

// createRemoteJWKSet caches fetched keys on the object it returns, so it
// must be created once per team domain and reused across requests — never
// per-call, or every request would re-fetch the JWKS. Access rotates signing
// keys every 6 weeks with a 7-day overlap, so the library's default caching
// is appropriate as-is.
const jwksByDomain = new Map<string, RemoteJwkSet>();

function jwksForDomain(teamDomain: string): RemoteJwkSet {
  let jwks = jwksByDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByDomain.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Lowercases ASCII A-Z only.
 *
 * Deliberately not `String.prototype.toLowerCase()`, which applies full Unicode
 * case folding and collapses distinct characters onto ASCII. The Kelvin sign
 * (U+212A) lowercases to "k", so `toLowerCase()` treats "miKe@example.com"
 * as equal to "mike@example.com" — a token for the former would match an
 * allow-list entry for the latter. Address comparison should not smuggle in
 * that equivalence.
 */
function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

function parseAllowList(adminEmails: string): string[] {
  return adminEmails
    .split(",")
    .map((entry) => asciiLowerCase(entry.trim()))
    .filter((entry) => entry.length > 0);
}

/**
 * Verifies the Cloudflare Access JWT on `request` and returns the caller's
 * identity, or `null` on any failure. Never throws, and never reveals which
 * check failed — the caller turns a `null` into an opaque 401.
 */
export async function verifyAccessToken(
  request: Request,
  env: Env,
): Promise<AccessIdentity | null> {
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) return null;

  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAILS } = env;

  // Fail closed on missing configuration. An empty or absent value here
  // must never be treated as "verification not required" — it must mean
  // deny. (This is exactly the shape of the earlier Turnstile bug: an empty
  // secret silently disabled bot protection.)
  if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD || !ADMIN_EMAILS) return null;

  const allowList = parseAllowList(ADMIN_EMAILS);
  if (allowList.length === 0) return null;

  try {
    const jwks = jwksForDomain(ACCESS_TEAM_DOMAIN);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ACCESS_TEAM_DOMAIN,
      audience: ACCESS_AUD,
      // Access signs with RS256. Pinning the algorithm keeps this decision in
      // our code rather than resting on the library's defaults. jose already
      // rejects `alg: none` and symmetric-key confusion against a JWKS
      // (verified empirically), so this is belt-and-braces against a future
      // default changing, not a fix for a known hole.
      algorithms: ["RS256"],
      // Without this, a token carrying no `exp` claim at all verifies happily
      // and never expires. Access always sets one, so this guards against a
      // token that is malformed in our favour rather than against Access.
      requiredClaims: ["exp"],
    });

    if (typeof payload.email !== "string") return null;
    const email = payload.email.trim();
    if (!allowList.includes(asciiLowerCase(email))) return null;

    return { email };
  } catch {
    // Any failure — bad signature, expired, wrong iss/aud, malformed token —
    // collapses to the same null. Do not distinguish failure reasons here.
    return null;
  }
}
