import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRequestId, logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import { wipeDisk } from "@/lib/server/modules/system/disk-service";
import type { DiskWipeRequest } from "@/lib/shared/contracts/disks";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      { layer: "api", action: "system.disks.wipe", requestId },
      async () => {
        const body = (await request.json()) as DiskWipeRequest;
        const { disk } = body;

        if (!disk) {
          return NextResponse.json({ error: "disk is required" }, { status: 400 });
        }

        await wipeDisk(disk);

        logServerAction({
          layer: "api",
          action: "system.disks.wipe.response",
          status: "success",
          requestId,
          message: `Wiped disk ${disk}`,
          meta: { userId: apiSession.session.userId, disk },
        });

        return NextResponse.json({ data: { accepted: true, action: "wipe" } });
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to wipe disk";
    const isValidationError =
      error instanceof Error &&
      (error.message.startsWith("Cannot wipe") ||
        error.message.startsWith("Cannot modify") ||
        error.message.startsWith("Invalid disk"));
    const statusCode = isValidationError ? 400 : 500;

    logServerAction({
      level: "error",
      layer: "api",
      action: "system.disks.wipe.response",
      status: "error",
      requestId,
      message,
      error,
    });
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
