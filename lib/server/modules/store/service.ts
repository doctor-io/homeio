import "server-only";

import { logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import { readFile } from "node:fs/promises";
import {
  findStoreCatalogTemplateByAppId,
  getStoreCatalogSnapshot,
  type StoreCatalogCategory,
} from "@/lib/server/modules/store/catalog";
import {
  findCustomStoreTemplateByAppId,
  listCustomStoreTemplates,
} from "@/lib/server/modules/store/custom-apps";
import {
  findInstalledStackByAppId,
  listInstalledStacksFromDb,
} from "@/lib/server/modules/apps/stacks-repository";
import { resolveInstalledComposePath } from "@/lib/server/modules/apps/installed-compose-path";
import {
  extractPrimaryServiceWithName,
  parseComposeFile,
} from "@/lib/server/modules/docker/compose-parser";
import { isTagUpdateAvailable } from "@/lib/server/modules/store/update-check";
import type {
  InstalledStackConfig,
  StoreAppDetail,
  StoreAppSummary,
  StoreAppSourceKind,
  StoreOperationAction,
} from "@/lib/shared/contracts/apps";
import { startStoreOperation } from "@/lib/server/modules/apps/operations";
import { patchInstalledStackMeta } from "@/lib/server/modules/apps/stacks-repository";

function includesSearch(text: string, search: string) {
  return text.toLowerCase().includes(search.toLowerCase());
}

const STORE_LIST_DESCRIPTION_LIMIT = 220;

function toSummaryDescription(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= STORE_LIST_DESCRIPTION_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, STORE_LIST_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

function toSummary(
  template:
    | Awaited<ReturnType<typeof getStoreCatalogSnapshot>>["apps"][number]
    | Awaited<ReturnType<typeof listCustomStoreTemplates>>[number],
  installed:
    | (Awaited<ReturnType<typeof listInstalledStacksFromDb>>[number] & {
        installedImage?: string | null;
      })
    | undefined,
): StoreAppSummary {
  const sourceKind: StoreAppSourceKind = "isCustom" in template ? "custom" : template.sourceKind;
  const sourceId = "isCustom" in template ? template.appId : template.sourceId;
  const sourceName = "isCustom" in template ? "Custom" : template.sourceName;
  const installedImage = installed?.installedImage ?? null;

  return {
    id: template.appId,
    name: installed?.displayName ?? template.name,
    description: toSummaryDescription(template.description),
    platform: template.platform,
    categories: template.categories,
    logoUrl: installed?.iconUrl ?? template.logoUrl,
    repositoryUrl: template.repositoryUrl,
    stackFile: template.stackFile,
    status: installed?.status ?? "not_installed",
    webUiPort: installed?.webUiPort ?? template.port ?? null,
    updateAvailable: installed != null && installed.status !== "not_installed"
      ? isTagUpdateAvailable(installedImage, template.image)
      : false,
    installedImage,
    image: template.image ?? null,
    sourceId,
    sourceName,
    sourceKind,
  };
}


async function resolveInstalledImage(installed: InstalledStackConfig | null | undefined) {
  if (!installed || installed.status === "not_installed") {
    return null;
  }

  const composePath = resolveInstalledComposePath({
    appId: installed.appId,
    composePath: installed.composePath,
    stackName: installed.stackName,
  });

  try {
    const composeContent = await readFile(composePath, "utf8");
    const parsed = parseComposeFile(composeContent);
    if (!parsed) {
      return null;
    }

    return extractPrimaryServiceWithName(parsed, installed.appId)?.service.image ?? null;
  } catch {
    return null;
  }
}

export async function getStoreCatalogView(options?: {
  category?: string;
  search?: string;
  installedOnly?: boolean;
  updatesOnly?: boolean;
}) {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "store.apps.catalog-view",
      meta: {
        category: options?.category ?? null,
        search: options?.search ?? null,
        installedOnly: Boolean(options?.installedOnly),
        updatesOnly: Boolean(options?.updatesOnly),
      },
    },
    async () => {
      const [catalogSnapshot, customTemplates, installedStacks] = await Promise.all([
        getStoreCatalogSnapshot(),
        listCustomStoreTemplates(),
        listInstalledStacksFromDb(),
      ]);

      const allTemplates = [...catalogSnapshot.apps, ...customTemplates];
      const installedByAppId = new Map(installedStacks.map((item) => [item.appId, item]));
      const installedImageEntries = await Promise.all(
        installedStacks.map(async (stack) => [
          stack.appId,
          await resolveInstalledImage(stack),
        ] as const),
      );
      const installedImageByAppId = new Map(installedImageEntries);

      let templates = allTemplates;

      if (options?.category) {
        templates = templates.filter((template) =>
          template.categories.some(
            (category) => category.toLowerCase() === options.category?.toLowerCase(),
          ),
        );
      }

      if (options?.search) {
        templates = templates.filter(
          (template) =>
            includesSearch(template.name, options.search as string) ||
            includesSearch(template.description, options.search as string),
        );
      }

      let apps = templates
        .map((template) => {
          const installed = installedByAppId.get(template.appId);
          return toSummary(
            template,
            installed
              ? { ...installed, installedImage: installedImageByAppId.get(template.appId) ?? null }
              : undefined,
          );
        })
        .sort((left, right) => left.name.localeCompare(right.name));

      if (options?.installedOnly) {
        apps = apps.filter((app) => app.status !== "not_installed");
      }

      if (options?.updatesOnly) {
        apps = apps.filter((app) => app.updateAvailable);
      }

      const categories: StoreCatalogCategory[] = customTemplates.length > 0
        ? [
            ...catalogSnapshot.categories,
            {
              id: "custom",
              name: "Custom",
              description: "Custom compose apps",
              appCount: customTemplates.length,
            },
          ]
        : catalogSnapshot.categories;

      return {
        apps,
        categories,
        featuredAppIds: catalogSnapshot.featuredAppIds,
        recommendedAppIds: catalogSnapshot.recommendedAppIds,
        sourcePath: catalogSnapshot.sourcePath,
        sources: catalogSnapshot.sources,
      };
    },
  );
}

export async function listStoreApps(options?: {
  category?: string;
  search?: string;
  installedOnly?: boolean;
  updatesOnly?: boolean;
}) {
  const view = await getStoreCatalogView(options);
  return view.apps;
}

export async function getStoreAppDetail(appId: string): Promise<StoreAppDetail | null> {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "store.apps.detail",
      meta: {
        appId,
      },
    },
    async () => {
      const [template, customTemplate, installedConfig] = await Promise.all([
        findStoreCatalogTemplateByAppId(appId),
        findCustomStoreTemplateByAppId(appId),
        findInstalledStackByAppId(appId),
      ]);

      const sourceTemplate = template ?? customTemplate;
      if (!sourceTemplate) {
        return null;
      }

      const summary = toSummary(
        sourceTemplate,
        installedConfig
          ? {
              ...installedConfig,
              installedImage: await resolveInstalledImage(installedConfig),
            }
          : undefined,
      );

      return {
        ...summary,
        description: sourceTemplate.description,
        note: sourceTemplate.note,
        env: sourceTemplate.env,
        screenshots: sourceTemplate.screenshots,
        installedConfig,
      };
    },
  );
}

export async function startAppLifecycleAction(input: {
  appId: string;
  action: StoreOperationAction;
  displayName?: string;
  env?: Record<string, string>;
  webUiPort?: number;
  composeSource?: string;
  removeVolumes?: boolean;
  resetToCatalog?: boolean;
}) {
  return withServerTiming(
    {
      layer: "service",
      action: "store.apps.lifecycle",
      meta: {
        appId: input.appId,
        action: input.action,
      },
    },
    async () =>
      startStoreOperation({
        appId: input.appId,
        action: input.action,
        displayName: input.displayName,
        env: input.env,
        webUiPort: input.webUiPort,
        composeSource: input.composeSource,
        removeVolumes: input.removeVolumes,
        resetToCatalog: input.resetToCatalog,
      }),
  );
}

export async function saveAppSettings(input: {
  appId: string;
  displayName?: string;
  iconUrl?: string | null;
  env?: Record<string, string>;
  webUiPort?: number;
  webUiUrl?: string | null;
  composeSource?: string;
}): Promise<{ operationId?: string }> {
  return withServerTiming(
    {
      layer: "service",
      action: "store.apps.settings.save",
      meta: {
        appId: input.appId,
        hasDisplayName: input.displayName !== undefined,
        hasIconUrl: input.iconUrl !== undefined,
        hasEnv: input.env !== undefined,
        envKeyCount: Object.keys(input.env ?? {}).length,
        hasPort: Boolean(input.webUiPort !== undefined),
        hasWebUiUrl: input.webUiUrl !== undefined,
        hasComposeSource: input.composeSource !== undefined,
      },
      onSuccessMeta: (result) => ({
        triggeredRedeploy: Boolean((result as { operationId?: string }).operationId),
      }),
    },
    async () => {
      const { appId, displayName, iconUrl, env, webUiPort, webUiUrl, composeSource } =
        input;

      // webUiUrl only changes the link we render, so it never warrants a redeploy.
      if (displayName !== undefined || iconUrl !== undefined || webUiUrl !== undefined) {
        await patchInstalledStackMeta(appId, { displayName, iconUrl, webUiUrl });
      }

      if (env !== undefined || webUiPort !== undefined || composeSource !== undefined) {
        const result = await startStoreOperation({
          appId,
          action: "redeploy",
          env,
          webUiPort,
          composeSource,
        });
        return { operationId: result.operationId };
      }

      return {};
    },
  );
}

export async function checkAllAppsForUpdates() {
  return withServerTiming(
    {
      layer: "service",
      action: "store.apps.check-updates",
    },
    async () => {
      const [installed, catalogSnapshot, customTemplates] = await Promise.all([
        listInstalledStacksFromDb(),
        getStoreCatalogSnapshot(),
        listCustomStoreTemplates(),
      ]);

      const templateByAppId = new Map(
        [...catalogSnapshot.apps, ...customTemplates].map((t) => [t.appId, t]),
      );

      const results: Array<{ appId: string; updateAvailable: boolean }> = [];

      for (const app of installed) {
        if (app.status === "not_installed") {
          continue;
        }

        try {
          const template = templateByAppId.get(app.appId);
          const installedImage = await resolveInstalledImage(app);
          const updateAvailable = isTagUpdateAvailable(installedImage, template?.image);

          const { updateStackUpdateStatus } = await import("@/lib/server/modules/apps/stacks-repository");
          await updateStackUpdateStatus({
            appId: app.appId,
            isUpToDate: !updateAvailable,
          });

          results.push({ appId: app.appId, updateAvailable });
        } catch (error) {
          logServerAction({
            level: "warn",
            layer: "service",
            action: "store.apps.check-updates.app",
            status: "error",
            message: "Failed to check updates for app",
            meta: { appId: app.appId },
            error,
          });
        }
      }

      return results;
    },
  );
}
