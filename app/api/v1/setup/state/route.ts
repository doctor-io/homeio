import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import { getOnboardingState } from "@/lib/server/modules/onboarding/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const state = await getOnboardingState();
    return NextResponse.json({ data: state });
  } catch (err) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "setup.state.get",
      status: "error",
      requestId,
      message: "Failed to read setup state",
      error: err,
    });
    return NextResponse.json(
      { error: "Failed to read setup state", code: "internal_error" },
      { status: 500 },
    );
  }
}
