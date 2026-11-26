import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import {
  getSystemUpdateChannel,
  setSystemUpdateChannel,
  SystemUpdateConflictError,
} from "@/lib/server/modules/system/update-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  try {
    return NextResponse.json({ data: await getSystemUpdateChannel() });
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.updates.channel.get",
      status: "error",
      requestId: createRequestId(),
      error,
    });
    return NextResponse.json({ error: "Failed to load the update channel." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const body = await request.json().catch(() => null);
  const channel = body?.channel;
  if (channel !== "stable" && channel !== "beta") {
    return NextResponse.json({ error: "Choose the Stable or Beta update channel." }, { status: 400 });
  }

  try {
    return NextResponse.json({ data: await setSystemUpdateChannel(channel) });
  } catch (error) {
    if (error instanceof SystemUpdateConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.updates.channel.put",
      status: "error",
      requestId: createRequestId(),
      error,
    });
    return NextResponse.json({ error: "Failed to save the update channel." }, { status: 500 });
  }
}
