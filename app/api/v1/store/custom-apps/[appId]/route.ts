import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import { deleteCustomStoreTemplate } from "@/lib/server/modules/store/custom-apps";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ appId: string }>;
};

export async function DELETE(request: Request, context: Context) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  const { appId } = await context.params;

  try {
    const removed = await deleteCustomStoreTemplate(appId);
    return NextResponse.json({ data: removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove the custom app";
    const notFound = /not found/i.test(message);

    logServerAction({
      level: notFound ? "warn" : "error",
      layer: "api",
      action: "store.customApps.delete",
      status: "error",
      requestId,
      message: "Failed to remove custom app",
      error: err,
      meta: { appId },
    });

    return NextResponse.json(
      { error: message, code: notFound ? "not_found" : "delete_failed" },
      { status: notFound ? 404 : 409 },
    );
  }
}
