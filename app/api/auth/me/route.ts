import { type NextRequest, NextResponse } from "next/server";
import {
  createRequestId,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { getAuthCookieName } from "@/lib/server/modules/auth/cookies";
import {
  findUserWithTotpById,
  hasAnyUsers,
} from "@/lib/server/modules/auth/repository";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { serverEnv } from "@/lib/server/env";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = createRequestId();
  const sessionToken = request.cookies.get(getAuthCookieName())?.value;

  const session = await withServerTiming(
    {
      layer: "api",
      action: "auth.me",
      requestId,
    },
    async () => authenticateSession(sessionToken),
  );

  if (!session) {
    // On first boot (no users in DB), redirect to /register instead of /login
    // so the user can set up their account rather than seeing a dead login form.
    const anyUsers = await hasAnyUsers().catch(() => true);
    const headers = anyUsers ? undefined : { "x-auth-entry": "/register" };
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers },
    );
  }

  const userRow = await findUserWithTotpById(session.userId).catch(() => null);

  return NextResponse.json({
    data: {
      id: session.userId,
      username: session.username,
      isDemoMode: serverEnv.DEMO_MODE,
      twoFactor: {
        enabled: userRow?.totpEnabled ?? false,
        enrolledAt: userRow?.totpEnrolledAt?.toISOString() ?? null,
      },
      hasSeenTour: userRow?.tourSeenAt != null,
    },
  });
}
