import "server-only";

import { NextResponse } from "next/server";
import { getAuthCookieName } from "@/lib/server/modules/auth/cookies";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { findApiTokenByPrefix, touchApiToken } from "@/lib/server/modules/auth/api-token-repository";
import {
  hasScope,
  isUsable,
  prefixOf,
  verifyToken,
} from "@/lib/server/modules/auth/api-token-service";
import {
  clearLoginFailures,
  getApiTokenRateLimitKey,
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/server/modules/auth/rate-limit";
import type { ApiTokenScope } from "@/lib/shared/contracts/api-tokens";
import { isElevated } from "@/lib/server/modules/auth/elevation";

export type ApiSession = NonNullable<Awaited<ReturnType<typeof authenticateSession>>>;

export type ApiSessionResult =
  | {
      session: ApiSession;
      response: null;
      /** Set when the caller authenticated with a token rather than a cookie. */
      tokenId?: string;
      scopes?: ApiTokenScope[];
    }
  | {
      session: null;
      response: NextResponse;
    };

function parseCookies(headerValue: string | null) {
  const cookies: Record<string, string> = {};
  if (!headerValue) return cookies;

  for (const segment of headerValue.split(";")) {
    const [rawKey, ...rawValueParts] = segment.split("=");
    const key = rawKey?.trim();
    if (!key) continue;

    const rawValue = rawValueParts.join("=").trim();
    if (!rawValue) continue;

    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }

  return cookies;
}

export function getSessionTokenFromRequest(request: Request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  return cookies[getAuthCookieName()] ?? null;
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return null;

  const value = rest.join("");
  return value.length > 0 ? value : null;
}

function clientIpOf(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function tooManyAttempts() {
  return NextResponse.json(
    { error: "Too many token attempts", code: "rate_limited" },
    { status: 429 },
  );
}

/**
 * The login limiter, keyed by token prefix instead of username — the prefix is
 * the credential's public half, exactly as a username is.
 *
 * Keyed that way on purpose. A guess at an unknown prefix is answered by an
 * indexed lookup and nothing else, so it is cheap and there is nothing to
 * protect; recording it would also let random prefixes grow the map without
 * bound. The attempt worth throttling is a guess at the *secret* of a prefix
 * that exists, because that is the one that reaches scrypt and the one that
 * could actually succeed.
 */
function tokenRateLimitKey(request: Request, prefix: string) {
  return getApiTokenRateLimitKey(request, prefix);
}

/**
 * Authenticates a request.
 *
 * The session cookie is tried first and its path is unchanged, so browser
 * traffic behaves exactly as it did before tokens existed.
 *
 * A bearer token is accepted **only** when the route names the scope it
 * requires. A route that says nothing keeps refusing tokens, so adding token
 * auth to the codebase cannot quietly open an endpoint nobody reviewed.
 */
export async function requireApiSession(
  request: Request,
  options?: { scope?: ApiTokenScope },
): Promise<ApiSessionResult> {
  const session = await authenticateSession(getSessionTokenFromRequest(request));
  if (session) {
    return { session, response: null };
  }

  const bearer = getBearerToken(request);
  if (!bearer || !options?.scope) {
    return { session: null, response: unauthorized() };
  }

  const record = await findApiTokenByPrefix(prefixOf(bearer));
  if (!record || !isUsable(record)) {
    return { session: null, response: unauthorized() };
  }

  const rateLimitKey = tokenRateLimitKey(request, record.prefix);
  if (isLoginRateLimited(rateLimitKey)) {
    return { session: null, response: tooManyAttempts() };
  }

  if (!(await verifyToken(bearer, record.tokenHash))) {
    recordLoginFailure(rateLimitKey);
    return { session: null, response: unauthorized() };
  }

  clearLoginFailures(rateLimitKey);

  if (!hasScope(record.scopes, options.scope)) {
    // Distinguished from "not authenticated": the credential is real, it just
    // does not carry this permission, and a 401 would send a client into a
    // pointless re-auth loop.
    return {
      session: null,
      response: NextResponse.json(
        { error: `This token lacks the ${options.scope} scope`, code: "insufficient_scope" },
        { status: 403 },
      ),
    };
  }

  // Best-effort: a usage stamp is not worth failing a request over.
  void touchApiToken(record.id, clientIpOf(request)).catch(() => {});

  return {
    // Token callers act as the single account, so downstream code that expects
    // a session keeps working unchanged.
    session: {
      sessionId: `token:${record.id}`,
      userId: `token:${record.id}`,
      username: record.name,
      passwordHash: "",
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : new Date(Date.now() + 3_600_000),
    } as ApiSession,
    response: null,
    tokenId: record.id,
    scopes: record.scopes,
  };
}

/**
 * Refuses a request that has not re-authenticated recently.
 *
 * Layered on top of {@link requireApiSession} rather than replacing it: a
 * caller needs a valid session *and* a fresh answer to "prove it is you". The
 * session says who; the elevation says you meant this one.
 *
 * Bearer tokens can never be elevated. A token is a stored credential — it
 * cannot be asked anything — so a route that requires elevation is closed to
 * them by construction. That is the intended answer: no API token wipes a disk.
 */
export async function requireElevatedSession(request: Request): Promise<ApiSessionResult> {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession;

  if (!isElevated(getSessionTokenFromRequest(request))) {
    return {
      session: null,
      response: NextResponse.json(
        {
          error: "This action needs your password again",
          code: "elevation_required",
        },
        { status: 403 },
      ),
    };
  }

  return apiSession;
}
