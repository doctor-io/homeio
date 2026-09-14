import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import {
  activateCloudflareTunnel,
  deactivateCloudflareTunnel,
  getCloudflareTunnelStatus,
} from "@/lib/server/modules/integrations/cloudflare-tunnel-service";
import { getCloudflareTunnelConfig } from "@/lib/server/modules/integrations/cloudflare-tunnel-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  return NextResponse.json(
    { data: await getCloudflareTunnelStatus() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Activate with the stored token, or the one supplied in the body. */
export async function POST(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    const bodyToken = typeof body.token === "string" ? body.token.trim() : "";
    const token = bodyToken || (await getCloudflareTunnelConfig()).token;

    if (!token) {
      return NextResponse.json(
        { error: "Save a connector token first", code: "validation_error" },
        { status: 400 },
      );
    }

    return NextResponse.json({ data: await activateCloudflareTunnel(token) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to activate the tunnel";
    logServerAction({ level: "error", layer: "api", action: "system.cloudflare-tunnel.activate", status: "error", requestId, message: "Failed to activate Cloudflare Tunnel", error: err });
    return NextResponse.json({ error: message, code: "activate_failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    return NextResponse.json({ data: await deactivateCloudflareTunnel() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to stop the tunnel";
    logServerAction({ level: "error", layer: "api", action: "system.cloudflare-tunnel.deactivate", status: "error", requestId, message: "Failed to stop Cloudflare Tunnel", error: err });
    return NextResponse.json({ error: message, code: "deactivate_failed" }, { status: 500 });
  }
}
