import { NextResponse } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { listUnmanagedContainers } from "@/lib/server/modules/docker/unmanaged-containers";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

/**
 * GET /api/v1/docker/containers
 *
 * Containers running on this host that Homeio did not deploy.
 * Response shape: { data: UnmanagedContainer[] }
 */
export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "docker.containers.list.get",
        requestId,
      },
      async () => {
        const containers = await listUnmanagedContainers();

        return NextResponse.json(
          { data: containers },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "docker.containers.list.get.response",
      status: "error",
      requestId,
      message: "Failed to list Docker containers",
      error,
    });

    return NextResponse.json(
      {
        error: "Failed to list Docker containers",
        code: "internal_error",
      },
      { status: 500 },
    );
  }
}
