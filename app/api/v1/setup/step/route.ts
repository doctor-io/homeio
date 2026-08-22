import { z } from "zod";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import {
  OnboardingError,
  recordOnboardingStep,
} from "@/lib/server/modules/onboarding/service";
import {
  ONBOARDING_FIRST_STEP,
  ONBOARDING_LAST_STEP,
  type OnboardingStepNumber,
} from "@/lib/shared/contracts/onboarding";

export const runtime = "nodejs";

// timezone and defaultStorageRoot are optional *and* nullable, and the two mean
// different things: an absent key leaves the stored answer alone, an explicit
// null clears it. Keep that distinction all the way down to the UPDATE.
const stepSchema = z.object({
  step: z.number().int().min(ONBOARDING_FIRST_STEP).max(ONBOARDING_LAST_STEP),
  timezone: z.string().nullable().optional(),
  defaultStorageRoot: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const parsed = stepSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "validation_error" },
        { status: 400 },
      );
    }

    const { step, timezone, defaultStorageRoot } = parsed.data;
    const state = await recordOnboardingStep({
      step: step as OnboardingStepNumber,
      ...(timezone === undefined ? {} : { timezone }),
      ...(defaultStorageRoot === undefined ? {} : { defaultStorageRoot }),
    });

    return NextResponse.json({ data: state });
  } catch (err) {
    if (err instanceof OnboardingError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }

    logServerAction({
      level: "error",
      layer: "api",
      action: "setup.step.post",
      status: "error",
      requestId,
      message: "Failed to save setup step",
      error: err,
    });
    return NextResponse.json(
      { error: "Failed to save setup step", code: "internal_error" },
      { status: 500 },
    );
  }
}
