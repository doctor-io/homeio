import { z } from "zod";
import { NextResponse } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { hasAnyUsers } from "@/lib/server/modules/auth/repository";
import { AuthError, registerUser, startSession } from "@/lib/server/modules/auth/service";
import {
  getAuthCookieName,
  getSessionCookieOptions,
} from "@/lib/server/modules/auth/cookies";
import { startOnboarding } from "@/lib/server/modules/onboarding/service";
import { bootstrapDefaultCasaosCatalog } from "@/lib/server/modules/store/catalog";
import {
  ensureDataRootDirectories,
  resolveDataRootDirectory,
} from "@/lib/server/storage/data-root";

export const runtime = "nodejs";

const registerSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  confirmPassword: z.string().min(1),
});

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    // Homeio is single-user, and the database already knows whether that user
    // exists — so nothing else gets a say. This used to be gated on an
    // AUTH_ALLOW_REGISTRATION env var as well, which install.sh wrote as
    // `true` and never turned off: a second source of truth for a fact the
    // first one already held, and when they disagreed the flag won. Any
    // script-installed server reachable from the internet would hand a full
    // account to whoever asked for one, with no roles to limit it.
    const usersExist = await hasAnyUsers();
    if (usersExist) {
      return NextResponse.json(
        {
          error: "Registration is closed: this server already has an account",
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
        },
        { status: 400 },
      );
    }

    await withServerTiming(
      {
        layer: "system",
        action: "storage.data.bootstrap",
        requestId,
        meta: {
          dataRoot: resolveDataRootDirectory(),
        },
      },
      async () => ensureDataRootDirectories(),
    );

    // Catalog bootstrap is best-effort during registration. A single broken
    // upstream YAML used to throw here and turn the whole register call into
    // a 500. The user can refresh the catalog later from Settings, and the
    // per-entry parser now skips broken stacks, so this should rarely fail —
    // but if it does, registration still succeeds.
    try {
      await withServerTiming(
        {
          layer: "system",
          action: "store.catalog.bootstrap",
          requestId,
        },
        async () => bootstrapDefaultCasaosCatalog(),
      );
    } catch (error) {
      logServerAction({
        level: "warn",
        layer: "api",
        action: "auth.register",
        status: "error",
        requestId,
        error,
        meta: { stage: "catalog_bootstrap_skipped" },
      });
    }

    const user = await withServerTiming(
      {
        layer: "api",
        action: "auth.register",
        requestId,
      },
      async () => registerUser(parsed.data),
    );

    // Only the very first account opens the first-run wizard. Best-effort on
    // purpose: an account that exists but skipped setup is a working install,
    // so a failure here must never turn a successful registration into a 500.
    if (!usersExist) {
      try {
        await startOnboarding();
      } catch (error) {
        logServerAction({
          level: "warn",
          layer: "api",
          action: "auth.register",
          status: "error",
          requestId,
          error,
          meta: { stage: "onboarding_start_skipped" },
        });
      }
    }

    // Sign them in here rather than sending them to the login screen: setup
    // follows registration, and asking for the password again in between puts
    // a gate in front of the first thing they came to do.
    const session = await startSession({ id: user.id, username: user.username });

    const response = NextResponse.json(
      {
        data: {
          id: user.id,
          username: user.username,
        },
      },
      { status: 201 },
    );

    response.cookies.set(
      getAuthCookieName(),
      session.token,
      getSessionCookieOptions(session.expiresAt, request),
    );

    return response;
  } catch (error) {
    const statusCode = error instanceof AuthError ? error.statusCode : 500;

    logServerAction({
      level: statusCode >= 500 ? "error" : "warn",
      layer: "api",
      action: "auth.register",
      status: "error",
      requestId,
      error,
    });

    return NextResponse.json(
      {
        error:
          error instanceof AuthError
            ? error.message
            : "Failed to register user",
      },
      { status: statusCode },
    );
  }
}
