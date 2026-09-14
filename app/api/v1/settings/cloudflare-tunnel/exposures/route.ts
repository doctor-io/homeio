import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import {
  listCloudflareTunnelExposures,
  saveCloudflareTunnelExposure,
} from "@/lib/server/modules/integrations/cloudflare-tunnel-exposure";
import type { CloudflareTunnelExposureSaveRequest } from "@/lib/shared/contracts/cloudflare-tunnel";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    return NextResponse.json(
      { data: await listCloudflareTunnelExposures() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    logServerAction({ level: "error", layer: "api", action: "settings.cloudflare-tunnel.exposures.get", status: "error", requestId, message: "Failed to list tunnel exposures", error: err });
    return NextResponse.json({ error: "Failed to list apps", code: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const body = (await request.json()) as Partial<CloudflareTunnelExposureSaveRequest>;
    const appId = typeof body.appId === "string" ? body.appId.trim() : "";

    if (!appId) {
      return NextResponse.json(
        { error: "appId is required", code: "validation_error" },
        { status: 400 },
      );
    }

    const exposure = await saveCloudflareTunnelExposure({
      appId,
      exposed: Boolean(body.exposed),
      subdomain: typeof body.subdomain === "string" ? body.subdomain : undefined,
    });

    return NextResponse.json({ data: exposure });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save exposure";
    logServerAction({ level: "error", layer: "api", action: "settings.cloudflare-tunnel.exposures.put", status: "error", requestId, message: "Failed to save tunnel exposure", error: err });
    return NextResponse.json({ error: message, code: "exposure_failed" }, { status: 400 });
  }
}
