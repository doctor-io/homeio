import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import {
  clearCloudflareTunnelConfig,
  getCloudflareTunnelConfigPublic,
  saveCloudflareTunnelConfig,
} from "@/lib/server/modules/integrations/cloudflare-tunnel-config";
import type { CloudflareTunnelConfigSaveRequest } from "@/lib/shared/contracts/cloudflare-tunnel";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    return NextResponse.json({ data: await getCloudflareTunnelConfigPublic() });
  } catch (err) {
    logServerAction({ level: "error", layer: "api", action: "settings.cloudflare-tunnel.get", status: "error", requestId, message: "Failed to read Cloudflare Tunnel config", error: err });
    return NextResponse.json({ error: "Failed to read config", code: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const body = (await request.json()) as Partial<CloudflareTunnelConfigSaveRequest>;
    const enabled = Boolean(body.enabled);
    const domain = typeof body.domain === "string" ? body.domain.trim() : "";

    const config = await saveCloudflareTunnelConfig({
      enabled,
      domain,
      token: typeof body.token === "string" ? body.token : undefined,
    });

    return NextResponse.json({ data: config });
  } catch (err) {
    logServerAction({ level: "error", layer: "api", action: "settings.cloudflare-tunnel.put", status: "error", requestId, message: "Failed to save Cloudflare Tunnel config", error: err });
    return NextResponse.json({ error: "Failed to save config", code: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    await clearCloudflareTunnelConfig();
    return NextResponse.json({ data: await getCloudflareTunnelConfigPublic() });
  } catch (err) {
    logServerAction({ level: "error", layer: "api", action: "settings.cloudflare-tunnel.delete", status: "error", requestId, message: "Failed to clear Cloudflare Tunnel config", error: err });
    return NextResponse.json({ error: "Failed to clear config", code: "internal_error" }, { status: 500 });
  }
}
