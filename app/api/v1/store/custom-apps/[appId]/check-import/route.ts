import { NextResponse } from "next/server";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import {
  ComposeImportError,
  fetchComposeFromUrl,
} from "@/lib/server/modules/store/compose-import";
import {
  backfillCustomStoreChecksum,
  checksumSource,
  findCustomStoreTemplateByAppId,
} from "@/lib/server/modules/store/custom-apps";

export const runtime = "nodejs";

type Context = { params: Promise<{ appId: string }> };

/**
 * Re-fetches a URL-sourced app and reports whether upstream has moved since it
 * was imported. Read-only on purpose: knowing an update exists and choosing to
 * take it are separate decisions, and the second one re-runs the risk gate.
 */
export async function POST(request: Request, context: Context) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  const { appId } = await context.params;

  try {
    const template = await findCustomStoreTemplateByAppId(appId);
    if (!template) {
      return NextResponse.json({ error: "App not found", code: "not_found" }, { status: 404 });
    }

    if (!template.sourceUrl) {
      return NextResponse.json(
        {
          error: "This app was not imported from a URL, so there is nothing to check",
          code: "not_imported",
        },
        { status: 409 },
      );
    }

    const fetched = await fetchComposeFromUrl(template.sourceUrl);
    const upstreamChecksum = checksumSource(fetched.content);

    // A row imported before C1 carries no checksum. Comparing against it
    // answered "changed" on every read, and nothing ever wrote one back, so the
    // state could not resolve: the app claimed an update was waiting for as
    // long as it existed, and nothing the user did could clear it. A badge that
    // is always lit is one people stop reading, including the day it is right.
    //
    // The match is provable after all — the text that was imported is stored
    // beside the checksum. Fall back to it, and record what it hashes to so the
    // next read has a checksum like any other row.
    const currentChecksum =
      template.sourceChecksum ??
      (template.sourceText ? checksumSource(template.sourceText) : null);

    if (!template.sourceChecksum && currentChecksum) {
      await backfillCustomStoreChecksum(appId, currentChecksum);
    }

    return NextResponse.json({
      data: {
        appId,
        sourceUrl: template.sourceUrl,
        sourceRef: template.sourceRef,
        lastImportedAt: template.lastImportedAt,
        currentChecksum,
        upstreamChecksum,
        // Still "changed" when there is nothing at all to compare against,
        // which is the case the original note was right about.
        changed: currentChecksum !== upstreamChecksum,
        upstreamContent: fetched.content,
      },
    });
  } catch (error) {
    if (error instanceof ComposeImportError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode },
      );
    }

    logServerAction({
      level: "error",
      layer: "api",
      action: "store.customApps.checkImport.post",
      status: "error",
      requestId,
      message: "Failed to check a custom app for upstream changes",
      error,
    });

    return NextResponse.json(
      { error: "Failed to check for updates", code: "internal_error" },
      { status: 500 },
    );
  }
}
