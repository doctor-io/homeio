import { type NextRequest, NextResponse } from "next/server";
import {
  createRequestId,
  withServerTiming,
} from "@/lib/server/logging/logger";
import {
  getAuthCookieName,
  getExpiredSessionCookieOptions,
} from "@/lib/server/modules/auth/cookies";
import { logoutSession } from "@/lib/server/modules/auth/service";
import { revokeElevation } from "@/lib/server/modules/auth/elevation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = createRequestId();
  const sessionToken = request.cookies.get(getAuthCookieName())?.value;

  await withServerTiming(
    {
      layer: "api",
      action: "auth.logout",
      requestId,
    },
    async () => {
      await logoutSession(sessionToken);
      // A session that ends takes its privileges with it. Otherwise the next
      // person to sign in on this machine inherits whatever window the last
      // one had left open.
      revokeElevation(sessionToken);
      return Promise.resolve();
    },
  );

  const response = NextResponse.json({
    ok: true,
  });

  response.cookies.set(
    getAuthCookieName(),
    "",
    getExpiredSessionCookieOptions(request),
  );

  return response;
}
