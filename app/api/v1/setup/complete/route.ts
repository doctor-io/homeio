import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import { finishOnboarding } from "@/lib/server/modules/onboarding/service";

export const runtime = "nodejs";

/**
 * Finishing and skipping the whole wizard are the same call — the wizard is
 * skippable at every step, so "skipped" is not a separate end state. Safe to
 * call against an install that already finished, or never started.
 */
export async function POST(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const state = await finishOnboarding();
    return NextResponse.json({ data: state });
  } catch (err) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "setup.complete.post",
      status: "error",
      requestId,
      message: "Failed to complete setup",
      error: err,
    });
    return NextResponse.json(
      { error: "Failed to complete setup", code: "internal_error" },
      { status: 500 },
    );
  }
}
