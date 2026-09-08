import "server-only";

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/server/db/drizzle";
import { appOperations, appStacks } from "@/lib/server/db/schema";
import type {
  InstalledApp,
  InstalledAppActiveOperation,
  StoreOperationAction,
  StoreOperationStatus,
} from "@/lib/shared/contracts/apps";

export async function listInstalledAppsFromDb(): Promise<InstalledApp[]> {
  const tableCheck = await db.execute<{ table_exists: string | null }>(
    sql`SELECT to_regclass('public.app_stacks') AS table_exists`,
  );
  if (!tableCheck.rows[0]?.table_exists) {
    return [];
  }

  const rows = await db
    .select({
      appId: appStacks.appId,
      templateName: appStacks.templateName,
      stackName: appStacks.stackName,
      composePath: appStacks.composePath,
      webUiPort: appStacks.webUiPort,
      webUiUrl: appStacks.webUiUrl,
      displayName: appStacks.displayName,
      updatedAt: appStacks.updatedAt,
    })
    .from(appStacks)
    .where(eq(appStacks.status, "installed"))
    .orderBy(asc(sql`COALESCE(${appStacks.displayName}, ${appStacks.templateName})`))
    .limit(200);

  return rows.map((row) => ({
    id: row.appId,
    name: row.displayName || row.templateName || row.appId,
    stackName: row.stackName,
    composePath: row.composePath,
    webUiPort: row.webUiPort,
    webUiUrl: row.webUiUrl ?? null,
    status: "unknown" as const,
    activeOperation: null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }));
}

export async function findActiveStoreOperationsByAppIds(
  appIds: string[],
): Promise<Record<string, InstalledAppActiveOperation>> {
  if (appIds.length === 0) {
    return {};
  }

  const tableCheck = await db.execute<{ table_exists: string | null }>(
    sql`SELECT to_regclass('public.app_operations') AS table_exists`,
  );
  if (!tableCheck.rows[0]?.table_exists) {
    return {};
  }

  const rows = await db
    .select({
      id: appOperations.id,
      appId: appOperations.appId,
      action: appOperations.action,
      status: appOperations.status,
      progressPercent: appOperations.progressPercent,
      currentStep: appOperations.currentStep,
      updatedAt: appOperations.updatedAt,
    })
    .from(appOperations)
    .where(
      and(
        inArray(appOperations.appId, appIds),
        or(eq(appOperations.status, "queued"), eq(appOperations.status, "running")),
      ),
    )
    .orderBy(asc(appOperations.appId), desc(appOperations.updatedAt));

  const activeByAppId: Record<string, InstalledAppActiveOperation> = {};

  for (const row of rows) {
    if (activeByAppId[row.appId]) {
      continue;
    }

    activeByAppId[row.appId] = {
      id: row.id,
      action: row.action as StoreOperationAction,
      status: row.status as StoreOperationStatus,
      progressPercent: row.progressPercent,
      currentStep: row.currentStep,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
  }

  return activeByAppId;
}
