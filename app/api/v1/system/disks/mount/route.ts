import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRequestId, logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import { getAuthCookieName } from "@/lib/server/modules/auth/cookies";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { describeDiskFailure, mountPartition } from "@/lib/server/modules/system/disk-service";
import type { DiskMountRequest } from "@/lib/shared/contracts/disks";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();
  const sessionToken = request.cookies.get(getAuthCookieName())?.value;

  try {
    return await withServerTiming(
      { layer: "api", action: "system.disks.mount", requestId },
      async () => {
        const session = await authenticateSession(sessionToken);
        if (!session) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await request.json()) as DiskMountRequest;
        const { device, mountPoint, addToFstab } = body;

        if (!device || !mountPoint) {
          return NextResponse.json({ error: "device and mountPoint are required" }, { status: 400 });
        }

        await mountPartition(device, mountPoint, addToFstab);

        logServerAction({
          layer: "api",
          action: "system.disks.mount.response",
          status: "success",
          requestId,
          message: `Mounted ${device} at ${mountPoint}`,
          meta: { userId: session.userId, device, mountPoint },
        });

        return NextResponse.json({ data: { accepted: true, action: "mount" } });
      },
    );
  } catch (error) {
    const { status, message } = describeDiskFailure(error, "Failed to mount partition");

    logServerAction({
      level: "error",
      layer: "api",
      action: "system.disks.mount.response",
      status: "error",
      requestId,
      message,
      error,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
