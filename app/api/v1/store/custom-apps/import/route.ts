import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import {
  ComposeImportError,
  fetchComposeFromUrl,
} from "@/lib/server/modules/store/compose-import";
import {
  ComposeRiskError,
  ComposeValidationError,
} from "@/lib/server/modules/store/compose-validation";
import { upsertCustomStoreTemplate } from "@/lib/server/modules/store/custom-apps";

export const runtime = "nodejs";

const importSchema = z.object({
  url: z.string().trim().min(1).max(2_048),
  name: z.string().trim().min(1).max(80).optional(),
  iconUrl: z.string().trim().max(1024).optional(),
  ref: z.string().trim().max(120).optional(),
  acknowledgeRisks: z.boolean().optional(),
});

/** Falls back to the file's directory, since compose files are rarely named usefully. */
function nameFromUrl(rawUrl: string) {
  try {
    const segments = new URL(rawUrl).pathname.split("/").filter(Boolean);
    const file = segments.at(-1) ?? "";
    const candidate = /^(docker-)?compose\.ya?ml$/i.test(file)
      ? (segments.at(-2) ?? file)
      : file.replace(/\.ya?ml$/i, "");
    return candidate.replace(/[-_]+/g, " ").trim() || "Imported app";
  } catch {
    return "Imported app";
  }
}

export async function POST(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();

  try {
    const parsed = importSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid import payload", code: "validation_error" },
        { status: 400 },
      );
    }

    return await withServerTiming(
      {
        layer: "api",
        action: "store.customApps.import.post",
        requestId,
      },
      async () => {
        const fetched = await fetchComposeFromUrl(parsed.data.url);
        const template = await upsertCustomStoreTemplate({
          name: parsed.data.name ?? nameFromUrl(fetched.url),
          iconUrl: parsed.data.iconUrl,
          sourceType: "url",
          sourceText: fetched.content,
          sourceUrl: fetched.url,
          sourceRef: parsed.data.ref,
          // A URL import is a new entry point, so nothing installs unseen: the
          // caller must have been shown the risks and said yes.
          acknowledgeRisks: parsed.data.acknowledgeRisks === true,
        });

        return NextResponse.json({ data: template }, { status: 201 });
      },
    );
  } catch (error) {
    if (error instanceof ComposeRiskError) {
      return NextResponse.json(
        { error: error.message, code: error.code, risks: error.risks },
        { status: 409 },
      );
    }

    if (error instanceof ComposeValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    }

    if (error instanceof ComposeImportError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode },
      );
    }

    // A parse failure is the user's file, not our bug: report it as such
    // rather than as a 500 they cannot act on.
    if (error instanceof Error && /compose|yaml|empty/i.test(error.message)) {
      return NextResponse.json(
        { error: error.message, code: "invalid_compose" },
        { status: 422 },
      );
    }

    logServerAction({
      level: "error",
      layer: "api",
      action: "store.customApps.import.post",
      status: "error",
      requestId,
      message: "Failed to import compose from URL",
      error,
    });

    return NextResponse.json(
      { error: "Failed to import that compose file", code: "internal_error" },
      { status: 500 },
    );
  }
}
