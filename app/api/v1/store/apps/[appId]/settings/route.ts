import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { saveAppSettings } from "@/lib/server/modules/store/service";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { StoreOperationError } from "@/lib/server/modules/apps/operations";

export const runtime = "nodejs";

const settingsSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  iconUrl: z
    .string()
    .trim()
    .url("iconUrl must be a valid URL")
    .max(500)
    .nullable()
    .optional(),
  env: z.record(z.string(), z.string()).optional(),
  webUiPort: z.number().int().min(1024).max(65535).optional(),
  webUiUrl: z
    .string()
    .trim()
    .url("webUiUrl must be a valid URL")
    .max(500)
    .nullable()
    .optional(),
  composeSource: z.string().trim().min(1).max(500_000).optional(),
});

type Context = {
  params: Promise<{
    appId: string;
  }>;
};

export async function PATCH(request: Request, context: Context) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();
  const { appId } = await context.params;

  try {
    const parsed = settingsSchema.safeParse(await request.json());

    return await withServerTiming(
      {
        layer: "api",
        action: "store.apps.settings.patch",
        requestId,
        meta: {
          appId,
          hasDisplayName: parsed.success ? parsed.data.displayName !== undefined : false,
          hasIconUrl: parsed.success ? parsed.data.iconUrl !== undefined : false,
          hasEnv: parsed.success ? parsed.data.env !== undefined : false,
          envKeyCount: parsed.success ? Object.keys(parsed.data.env ?? {}).length : 0,
          hasWebUiPort: parsed.success ? parsed.data.webUiPort !== undefined : false,
          hasWebUiUrl: parsed.success ? parsed.data.webUiUrl !== undefined : false,
          hasComposeSource: parsed.success ? parsed.data.composeSource !== undefined : false,
          invalidPayload: !parsed.success,
        },
      },
      async () => {
        if (!parsed.success) {
          return NextResponse.json(
            {
              error: "Invalid settings payload",
              issues: parsed.error.flatten(),
            },
            { status: 400 },
          );
        }

        const result = await saveAppSettings({
          appId,
          ...parsed.data,
        });

        return NextResponse.json(
          {
            saved: true,
            operationId: result.operationId,
          },
          { status: 200 },
        );
      },
    );
  } catch (error) {
    if (error instanceof StoreOperationError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
        },
        { status: error.statusCode },
      );
    }

    logServerAction({
      level: "error",
      layer: "api",
      action: "store.apps.settings.patch.response",
      status: "error",
      requestId,
      message: "Failed to save app settings",
      error,
      meta: {
        appId,
      },
    });

    return NextResponse.json(
      {
        error: "Failed to save app settings",
      },
      { status: 500 },
    );
  }
}
