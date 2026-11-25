import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { scheduleSystemUpdate, SystemUpdateConflictError } from "@/lib/server/modules/system/update-service";
import { emitPowerAction } from "@/lib/server/modules/system/power-action-events";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();
  const expectedVersion = new URL(request.url).searchParams.get("version") ?? undefined;

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.updates.apply.post",
        requestId,
      },
      async () => {
        const accepted = await scheduleSystemUpdate(expectedVersion);
        emitPowerAction("update");

        logServerAction({
          layer: "api",
          action: "system.updates.apply.scheduled",
          status: "success",
          requestId,
          message: "Scheduled Homeio update",
          meta: {
            userId: apiSession.session.userId,
            username: apiSession.session.username,
          },
        });

        return NextResponse.json({ data: accepted }, { status: 202 });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.updates.apply.response",
      status: "error",
      requestId,
      message: "Failed to schedule Homeio update",
      error,
    });

    const message = error instanceof Error ? error.message : "Failed to schedule Homeio update";
    if (error instanceof SystemUpdateConflictError) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    const statusCode =
      error instanceof Error &&
      (error.message.includes("Docker") ||
        error.message.includes("systemd-run") ||
        error.message.includes("already in progress"))
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
