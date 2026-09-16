import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRequestId, logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import { getAuthCookieName } from "@/lib/server/modules/auth/cookies";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { deletePartition } from "@/lib/server/modules/system/disk-service";
import type { DiskDeletePartitionRequest } from "@/lib/shared/contracts/disks";
import { requireElevatedSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiSession = await requireElevatedSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();
  const sessionToken = request.cookies.get(getAuthCookieName())?.value;

  try {
    return await withServerTiming(
      { layer: "api", action: "system.disks.delete-partition", requestId },
      async () => {
        const session = await authenticateSession(sessionToken);
        if (!session) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await request.json()) as DiskDeletePartitionRequest;
        const { device } = body;

        if (!device) {
          return NextResponse.json({ error: "device is required" }, { status: 400 });
        }

        await deletePartition(device);

        logServerAction({
          layer: "api",
          action: "system.disks.delete-partition.response",
          status: "success",
          requestId,
          message: `Deleted partition ${device}`,
          meta: { userId: session.userId, device },
        });

        return NextResponse.json({ data: { accepted: true, action: "delete-partition" } });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.disks.delete-partition.response",
      status: "error",
      requestId,
      message: "Failed to delete partition",
      error,
    });
    return NextResponse.json({ error: "Failed to delete partition" }, { status: 500 });
  }
}
