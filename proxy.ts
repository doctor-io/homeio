import {
  AUTH_SESSION_COOKIE_NAME,
  isSessionExpired,
  parseSessionToken,
} from "@/lib/shared/auth/session";
import { type NextRequest, NextResponse } from "next/server";

const DEMO_MODE = process.env.DEMO_MODE === "true";
const DEMO_BLOCKED_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

const PUBLIC_ROUTES = new Set(["/login", "/register"]);
const RECOVERY_ROUTES = new Set(["/updating"]);
const AUTH_STATUS_CACHE_MS = 5_000;
let authStatusCache:
  | {
      hasUsers: boolean;
      expiresAt: number;
    }
  | null = null;

export function resetAuthStatusCacheForTests() {
  authStatusCache = null;
}

function isPublicApiRoute(pathname: string) {
  return (
    pathname === "/api/health" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/register" ||
    pathname === "/api/auth/status" ||
    // Second leg of the TOTP login flow. Caller has no session cookie yet —
    // only a short-lived partial-auth token. Route handler validates that
    // token itself; do not gate it on a session.
    pathname === "/api/v1/auth/login/totp" ||
    pathname === "/api/v1/logs"
  );
}

function isStaticRoute(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/images/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/apple-icon.png" ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  );
}

async function signPayloadEdge(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );

  return Array.from(new Uint8Array(signatureBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return mismatch === 0;
}

export async function verifySessionTokenInMiddleware(
  sessionToken: string | undefined,
  secret = process.env.AUTH_SESSION_SECRET ?? "dev-session-secret-change-me",
) {
  if (!sessionToken) return false;

  const parsed = parseSessionToken(sessionToken);
  if (!parsed) return false;
  if (isSessionExpired(parsed.expiresAtEpochSeconds)) return false;

  const expected = await signPayloadEdge(parsed.payload, secret);
  return safeEqual(expected, parsed.signature);
}

async function hasUsersInDb(request: NextRequest) {
  const now = Date.now();
  if (authStatusCache && authStatusCache.expiresAt > now) {
    return authStatusCache.hasUsers;
  }

  try {
    const response = await fetch(new URL("/api/auth/status", request.url), {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Auth status request failed");
    }

    const json = (await response.json()) as {
      data?: {
        hasUsers?: boolean;
      };
    };

    const hasUsers = typeof json.data?.hasUsers === "boolean" ? json.data.hasUsers : false;
    authStatusCache = {
      hasUsers,
      expiresAt: now + AUTH_STATUS_CACHE_MS,
    };
    return hasUsers;
  } catch {
    if (authStatusCache) {
      return authStatusCache.hasUsers;
    }

    // Not knowing is not the same as knowing there is nobody. Answering `false`
    // here says "fresh install": the visitor is sent to registration, and an
    // authenticated one has their session cookie cleared on the way — a
    // momentary database or network hiccup logging everyone out and offering
    // the machine up for registration. Assuming accounts exist costs a real
    // fresh install one redirect to /login; the other way costs a running
    // install its sessions.
    return true;
  }
}

function getAuthEntryPath(hasUsers: boolean) {
  return hasUsers ? "/login" : "/register";
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: AUTH_SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    expires: new Date(0),
  });
  return response;
}

/**
 * Nothing this middleware touches may sit in a shared cache.
 *
 * Homeio is commonly published through a tunnel or a CDN — the docs recommend
 * exactly that — and a cache in front that keeps redirects will serve one
 * visitor's answer to everybody. An install that was briefly empty answers
 * `307 -> /register`; once that is cached, every later visitor is sent to
 * registration no matter how many accounts exist, and the session cookie they
 * just earned is thrown away on the way back. Incognito does not help, nor
 * does another browser or another device: the cache is upstream of all of them,
 * which is exactly what makes it look like a server-side bug.
 *
 * Immutable assets are unaffected — `_next/static` never reaches this
 * middleware, by the matcher below — so they keep the long-lived caching that
 * makes them worth caching.
 */
function withoutSharedCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  const response = await route(request);

  // Static files are the exception, and the only one: they carry no session,
  // they change name when they change content, and caching them is the whole
  // point of putting a CDN in front of anything.
  return isStaticRoute(request.nextUrl.pathname) ? response : withoutSharedCaching(response);
}

async function route(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isStaticRoute(pathname)) {
    return NextResponse.next();
  }

  if (isPublicApiRoute(pathname)) {
    return NextResponse.next();
  }

  if (
    DEMO_MODE &&
    DEMO_BLOCKED_METHODS.has(request.method) &&
    pathname.startsWith("/api/v1/")
  ) {
    return NextResponse.json(
      { error: "This action is not available in demo mode." },
      { status: 403 },
    );
  }

  const sessionToken = request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = await verifySessionTokenInMiddleware(sessionToken);

  if (PUBLIC_ROUTES.has(pathname)) {
    const hasUsers = await hasUsersInDb(request);
    const expectedPublicPath = getAuthEntryPath(hasUsers);

    if (isAuthenticated) {
      if (!hasUsers) {
        if (pathname === "/register") {
          return clearSessionCookie(NextResponse.next());
        }

        return clearSessionCookie(
          NextResponse.redirect(new URL("/register", request.url)),
        );
      }

      return NextResponse.redirect(new URL("/", request.url));
    }

    if (pathname !== expectedPublicPath) {
      return NextResponse.redirect(new URL(expectedPublicPath, request.url));
    }

    return NextResponse.next();
  }

  if (RECOVERY_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  if (isAuthenticated) {
    const hasUsers = await hasUsersInDb(request);

    if (!hasUsers) {
      if (pathname.startsWith("/api/")) {
        if (pathname === "/api/auth/me") {
          const response = NextResponse.json(
            {
              error: "Unauthorized",
              redirectTo: "/register",
            },
            { status: 401 },
          );
          response.headers.set("x-auth-entry", "/register");
          return clearSessionCookie(response);
        }

        return clearSessionCookie(
          NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        );
      }

      return clearSessionCookie(
        NextResponse.redirect(new URL("/register", request.url)),
      );
    }
  }

  if (!isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/auth/me") {
        const hasUsers = await hasUsersInDb(request);
        const authEntry = getAuthEntryPath(hasUsers);
        const response = NextResponse.json(
          {
            error: "Unauthorized",
            redirectTo: authEntry,
          },
          { status: 401 },
        );
        response.headers.set("x-auth-entry", authEntry);
        return response;
      }

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hasUsers = await hasUsersInDb(request);
    const authUrl = new URL(getAuthEntryPath(hasUsers), request.url);
    authUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(authUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
