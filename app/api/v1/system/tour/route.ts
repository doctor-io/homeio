import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import { markTourSeen } from "@/lib/server/modules/auth/repository";

export const runtime = "nodejs";

/**
 * Record that this account has seen the desktop tour.
 *
 * Kept against the user rather than the browser: signing in from a phone or a
 * second laptop should not replay an introduction someone already sat through.
 */
export async function POST(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();

  try {
    await markTourSeen(apiSession.session.userId);
    return NextResponse.json({ data: { hasSeenTour: true } });
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.tour.seen",
      status: "error",
      requestId,
      message: "Could not record the tour as seen",
      error,
    });

    return NextResponse.json(
      { error: "Could not record the tour", code: "internal_error" },
      { status: 500 },
    );
  }
}
