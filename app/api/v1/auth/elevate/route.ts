import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { getSessionTokenFromRequest, requireApiSession } from "@/lib/server/modules/auth/api";
import { grantElevation } from "@/lib/server/modules/auth/elevation";
import {
  clearLoginFailures,
  getLoginRateLimitKey,
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/server/modules/auth/rate-limit";
import { AuthError, verifyUnlockPassword } from "@/lib/server/modules/auth/service";

export const runtime = "nodejs";

const elevateSchema = z.object({
  password: z.string().min(1),
});

/**
 * Re-authenticates an existing session so it may do something irreversible.
 *
 * This proves intent, not identity — the session already proved identity. It is
 * the same question sudo asks, for the same reason: being signed in does not
 * mean you meant to erase a disk.
 *
 * Rate limited on the same counter as signing in. Without that, this endpoint
 * would be a quieter place to guess a password than the login form, and it
 * needs no username to attack.
 */
export async function POST(request: Request) {
  const requestId = createRequestId();

  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const rateLimitKey = getLoginRateLimitKey(request, apiSession.session.username);
  if (isLoginRateLimited(rateLimitKey)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later.", code: "rate_limited" },
      { status: 429 },
    );
  }

  const parsed = elevateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  try {
    const expiresAt = await withServerTiming(
      { layer: "api", action: "auth.elevate", requestId },
      async () => {
        await verifyUnlockPassword({
          sessionToken: getSessionTokenFromRequest(request),
          password: parsed.data.password,
        });

        clearLoginFailures(rateLimitKey);
        return grantElevation(getSessionTokenFromRequest(request)!);
      },
    );

    return NextResponse.json({ data: { expiresAt: new Date(expiresAt).toISOString() } });
  } catch (error) {
    recordLoginFailure(rateLimitKey);

    const statusCode = error instanceof AuthError ? error.statusCode : 500;

    logServerAction({
      level: statusCode >= 500 ? "error" : "warn",
      layer: "api",
      action: "auth.elevate",
      status: "error",
      requestId,
      // The username, never the attempt: a mistyped password is one keystroke
      // away from the real one, and this line would outlive both.
      meta: { username: apiSession.session.username },
      error,
    });

    return NextResponse.json(
      { error: statusCode === 500 ? "Failed to verify password" : "Invalid password" },
      { status: statusCode },
    );
  }
}
