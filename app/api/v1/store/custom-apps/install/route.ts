import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import {
  upsertCustomStoreTemplate,
} from "@/lib/server/modules/store/custom-apps";
import { startAppLifecycleAction } from "@/lib/server/modules/store/service";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { StoreOperationError } from "@/lib/server/modules/apps/operations";
import {
  ComposeRiskError,
  ComposeValidationError,
} from "@/lib/server/modules/store/compose-validation";

export const runtime = "nodejs";

const installCustomAppSchema = z.object({
  name: z.string().trim().min(1).max(80),
  iconUrl: z.string().trim().max(1024).optional(),
  repositoryUrl: z.string().trim().max(1024).optional(),
  sourceType: z.enum(["docker-compose", "docker-run"]),
  source: z.string().trim().min(1).max(50_000),
  acknowledgeRisks: z.boolean().optional(),
});

function isCustomAppRequestError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "Custom app name is required" ||
    error.message === "Custom app source cannot be empty" ||
    error.message.startsWith("Invalid docker run command:") ||
    error.message.startsWith("Invalid compose")
  );
}

export async function POST(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "store.customApps.install.post",
        requestId,
      },
      async () => {
        const parsed = installCustomAppSchema.safeParse(await request.json());
        if (!parsed.success) {
          return NextResponse.json(
            {
              error: "Invalid custom app payload",
              issues: parsed.error.flatten(),
            },
            { status: 400 },
          );
        }

        const customTemplate = await upsertCustomStoreTemplate({
          name: parsed.data.name,
          iconUrl: parsed.data.iconUrl,
          sourceType: parsed.data.sourceType,
          sourceText: parsed.data.source,
          repositoryUrl: parsed.data.repositoryUrl,
          // Defaults to true here, unlike the import route. This endpoint
          // shipped before the risk gate existed, and turning an install that
          // worked in 1.7 into a 409 would break callers that never got the
          // chance to acknowledge anything. The UI sends false and shows the
          // risks first; a script keeps its old behaviour.
          acknowledgeRisks: parsed.data.acknowledgeRisks ?? true,
        });

        const operation = await startAppLifecycleAction({
          appId: customTemplate.appId,
          action: "install",
          displayName: customTemplate.name,
        });

        return NextResponse.json(
          {
            appId: customTemplate.appId,
            operationId: operation.operationId,
          },
          { status: 202 },
        );
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

    if (error instanceof StoreOperationError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
        },
        { status: error.statusCode },
      );
    }

    const status = isCustomAppRequestError(error) ? 400 : 500;
    const message =
      error instanceof Error && isCustomAppRequestError(error)
        ? error.message
        : "Unable to install custom app";

    logServerAction({
      level: status === 400 ? "warn" : "error",
      layer: "api",
      action: "store.customApps.install.post.response",
      status: "error",
      requestId,
      message,
      error,
    });

    return NextResponse.json(
      {
        error: message,
      },
      { status },
    );
  }
}
