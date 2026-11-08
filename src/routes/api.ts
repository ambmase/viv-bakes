import { verifyAccessToken, type AccessIdentity } from "../auth/access";
import { handlePhotosRequest } from "./photos";
import type { Env } from "../types";

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Verifies the caller is an authorised admin. Returns the identity on
 * success, or a ready-to-return 401 `Response` on failure. The response body
 * is deliberately generic — it must not reveal which check failed (missing
 * header, bad signature, expired, wrong audience, non-allow-listed email,
 * etc.) to a caller probing the endpoint.
 */
export async function requireAdmin(
  request: Request,
  env: Env,
): Promise<AccessIdentity | Response> {
  const identity = await verifyAccessToken(request, env);
  if (!identity) return jsonError(401, "unauthorized");
  return identity;
}

/**
 * Entry point for `/api/*`. Deny by default: `requireAdmin` runs before any
 * routing decision, so an unrecognised path is refused with 401 rather than
 * falling through to a 404 that would let an unauthenticated caller
 * distinguish "no such route" from "not allowed here". Only once the caller
 * is authorised does an unrecognised path become a 404.
 */
export async function handleApiRequest(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  if (pathname === "/api/me") {
    return new Response(JSON.stringify({ email: admin.email }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname.startsWith("/api/photos")) {
    return handlePhotosRequest(request, env, pathname);
  }

  return jsonError(404, "not found");
}
