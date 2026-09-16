import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRequestId, logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import { getAuthCookieName } from "@/lib/server/modules/auth/cookies";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { formatPartition } from "@/lib/server/modules/system/disk-service";
import { DISK_FILESYSTEMS, type DiskFormatRequest } from "@/lib/shared/contracts/disks";
import { requireElevatedSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiSession = await requireElevatedSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();
  const sessionToken = request.cookies.get(getAuthCookieName())?.value;

  try {
    return await withServerTiming(
      { layer: "api", action: "system.disks.format", requestId },
      async () => {
        const session = await authenticateSession(sessionToken);
        if (!session) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await request.json()) as DiskFormatRequest;
        const { device, filesystem, label } = body;

        if (!device || !filesystem) {
          return NextResponse.json({ error: "device and filesystem are required" }, { status: 400 });
        }

        if (!(DISK_FILESYSTEMS as readonly string[]).includes(filesystem)) {
          return NextResponse.json({ error: "Unsupported filesystem" }, { status: 400 });
        }

        await formatPartition(device, filesystem, label);

        logServerAction({
          layer: "api",
          action: "system.disks.format.response",
          status: "success",
          requestId,
          message: `Formatted ${device} as ${filesystem}`,
          meta: { userId: session.userId, device, filesystem },
        });

        return NextResponse.json({ data: { accepted: true, action: "format" } }, { status: 200 });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.disks.format.response",
      status: "error",
      requestId,
      message: "Failed to format partition",
      error,
    });
    return NextResponse.json({ error: "Failed to format partition" }, { status: 500 });
  }
}
