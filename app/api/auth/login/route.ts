import { z } from "zod";
import { NextResponse } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import {
  getAuthCookieName,
  getSessionCookieOptions,
} from "@/lib/server/modules/auth/cookies";
import { AuthError, loginUser } from "@/lib/server/modules/auth/service";
import {
  clearLoginFailures,
  getLoginRateLimitKey,
  isLoginRateLimited,
  LOGIN_FAILURE_ALERT_THRESHOLD,
  recordLoginFailure,
} from "@/lib/server/modules/auth/rate-limit";
import { createNotification } from "@/lib/server/modules/notifications/service";
import { SECURITY_NOTIFICATION_TITLE } from "@/lib/shared/contracts/notifications";

export const runtime = "nodejs";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const requestId = createRequestId();
  let rateLimitKey: string | null = null;

  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
        },
        { status: 400 },
      );
    }

    rateLimitKey = getLoginRateLimitKey(request, parsed.data.username);
    if (isLoginRateLimited(rateLimitKey)) {
      return NextResponse.json(
        {
          error: "Too many login attempts",
        },
        { status: 429 },
      );
    }

    const loginResult = await withServerTiming(
      {
        layer: "api",
        action: "auth.login",
        requestId,
      },
      async () => loginUser(parsed.data),
    );

    // Password was valid regardless of branch — clear the rate-limit counter
    // so a TOTP-required user who later fat-fingers their code on A8 isn't
    // locked out of /api/auth/login itself.
    clearLoginFailures(rateLimitKey);

    if (loginResult.kind === "partial") {
      return NextResponse.json({
        data: {
          requiresTotp: true,
          partialAuthToken: loginResult.partialAuthToken,
        },
      });
    }

    const response = NextResponse.json({
      data: {
        id: loginResult.user.id,
        username: loginResult.user.username,
      },
    });

    response.cookies.set(
      getAuthCookieName(),
      loginResult.token,
      getSessionCookieOptions(loginResult.expiresAt, request),
    );

    return response;
  } catch (error) {
    const statusCode = error instanceof AuthError ? error.statusCode : 500;
    if (statusCode === 401 && rateLimitKey) {
      const failures = recordLoginFailure(rateLimitKey);

      // Once, when the lockout threshold is reached — not once per attempt.
      // A wrong password is a typo; five in fifteen minutes is someone trying.
      // The key is "username:ip", which is exactly what the operator needs to
      // recognise whether it was them.
      if (failures === LOGIN_FAILURE_ALERT_THRESHOLD) {
        const [attemptedUsername, clientIp] = rateLimitKey.split(":");
        void createNotification({
          title: SECURITY_NOTIFICATION_TITLE,
          body: `${failures} failed attempts for "${attemptedUsername}" from ${clientIp}. Sign-in is now blocked for 15 minutes.`,
          kind: "error",
        }).catch(() => undefined);
      }
    }

    logServerAction({
      level: statusCode >= 500 ? "error" : "warn",
      layer: "api",
      action: "auth.login",
      status: "error",
      requestId,
      error,
    });

    return NextResponse.json(
      {
        error:
          error instanceof AuthError
            ? error.message
            : "Failed to login",
      },
      { status: statusCode },
    );
  }
}
