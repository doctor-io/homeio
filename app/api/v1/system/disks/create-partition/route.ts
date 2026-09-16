import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRequestId, logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import { getAuthCookieName } from "@/lib/server/modules/auth/cookies";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { createPartition, describeDiskFailure } from "@/lib/server/modules/system/disk-service";
import type { DiskCreatePartitionRequest } from "@/lib/shared/contracts/disks";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();
  const sessionToken = request.cookies.get(getAuthCookieName())?.value;

  try {
    return await withServerTiming(
      { layer: "api", action: "system.disks.create-partition", requestId },
      async () => {
        const session = await authenticateSession(sessionToken);
        if (!session) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await request.json()) as DiskCreatePartitionRequest;
        const { disk, start, end } = body;

        if (!disk || !start || !end) {
          return NextResponse.json({ error: "disk, start, and end are required" }, { status: 400 });
        }

        await createPartition(disk, start, end);

        logServerAction({
          layer: "api",
          action: "system.disks.create-partition.response",
          status: "success",
          requestId,
          message: `Created partition on ${disk} (${start}–${end})`,
          meta: { userId: session.userId, disk, start, end },
        });

        return NextResponse.json({ data: { accepted: true, action: "create-partition" } }, { status: 201 });
      },
    );
  } catch (error) {
    const { status, message } = describeDiskFailure(error, "Failed to create partition");

    logServerAction({
      level: "error",
      layer: "api",
      action: "system.disks.create-partition.response",
      status: "error",
      requestId,
      message,
      error,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
