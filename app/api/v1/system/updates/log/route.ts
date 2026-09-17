import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { readUpdateLog } from "@/lib/server/modules/system/update-service";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

/**
 * Polled rather than streamed, unlike the rest of the live data in Homeio.
 *
 * An update restarts the service it is updating, so an SSE connection here
 * would be severed halfway through every single time, at the exact moment the
 * user most wants to see what is happening. The recovery screen already polls
 * /api/health through the restart for the same reason; this rides along with
 * it, and a request that fails while the service is down is simply retried.
 */
export async function GET(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  const rawOffset = request.nextUrl.searchParams.get("offset");
  const parsedOffset = rawOffset === null ? undefined : Number.parseInt(rawOffset, 10);
  const offset =
    typeof parsedOffset === "number" && Number.isFinite(parsedOffset) && parsedOffset >= 0
      ? parsedOffset
      : undefined;

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.updates.log.get",
        requestId,
      },
      async () => NextResponse.json({ data: await readUpdateLog(offset) }),
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.updates.log.response",
      status: "error",
      requestId,
      message: "Failed to read the Homeio update log",
      error,
    });

    return NextResponse.json({ error: "Failed to read the update log" }, { status: 500 });
  }
}
