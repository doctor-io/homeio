import "server-only";

import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { LruCache } from "@/lib/server/cache/lru";
import { serverEnv } from "@/lib/server/env";
import { logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import { ensureDataRootDirectories } from "@/lib/server/storage/data-root";
import {
  type AppDefinition,
  parseComposeToApp,
} from "@/lib/server/modules/store/casaos-compose-mapper";
import {
  OFFICIAL_STORE_SOURCE_ID,
  mutateStoreCatalogSources,
  readStoreCatalogConfig,
  readStoreCatalogSources,
  resolveStoreCatalogsRoot,
  writeStoreCatalogConfig,
} from "@/lib/server/modules/store/catalog-config";
import type {
  StoreCatalogSource,
  StoreCatalogSourceKind,
} from "@/lib/shared/contracts/apps";

const execFileAsync = promisify(execFile);

export const CASAOS_APPSTORE_REPO_URL = "https://github.com/IceWhaleTech/CasaOS-AppStore";
const CASAOS_REPO_DIRNAME = "CasaOS-AppStore";
const APPS_DIRECTORY_CANDIDATES = ["Apps", "Store"] as const;
const REMOTE_SOURCE_DIRNAME = "sources";

type CasaosCategoryEntry = {
  name?: unknown;
  description?: unknown;
};

type CasaosAppReference = {
  appid?: unknown;
};

export type StoreCatalogTemplate = AppDefinition & {
  sourceId: string;
  sourceName: string;
  sourceKind: StoreCatalogSourceKind;
};

export type StoreCatalogCategory = {
  id: string;
  name: string;
  description: string;
  appCount: number;
};

export type StoreCatalogSnapshot = {
  apps: StoreCatalogTemplate[];
  categories: StoreCatalogCategory[];
  featuredAppIds: string[];
  recommendedAppIds: string[];
  sourcePath: string;
  sources: StoreCatalogSource[];
};

type SourceSnapshot = {
  source: StoreCatalogSource;
  apps: StoreCatalogTemplate[];
  categoryEntries: CasaosCategoryEntry[];
  featuredAppIds: string[];
  recommendedAppIds: string[];
  sourcePath: string;
};

type CacheEntry = {
  signature: string;
  snapshot: SourceSnapshot;
  /** Serve the cached snapshot without touching disk until this timestamp. */
  revalidateAfter: number;
};

const catalogCache = new LruCache<CacheEntry>(16, serverEnv.STORE_CATALOG_TTL_MS);

/**
 * How long a cached snapshot is trusted before we re-stat the catalog to check
 * for on-disk changes. Building the signature costs one stat per app (the CasaOS
 * store ships ~1000), so doing it per request pegged the CPU and starved the
 * libuv fs pool — every App Store search keystroke walked the whole catalog.
 * Explicit syncs (refreshStoreCatalogSource) bypass this entirely.
 */
const CATALOG_REVALIDATE_INTERVAL_MS = 30_000;

function normalizeCategoryId(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function defaultCatalogPath() {
  return path.join(resolveStoreCatalogsRoot(), CASAOS_REPO_DIRNAME);
}

function isStoreSourceClientError(message: string) {
  return (
    /must use https/i.test(message) ||
    /already exists/i.test(message) ||
    /cannot be disabled/i.test(message) ||
    /cannot be removed/i.test(message) ||
    /must contain an Apps or Store directory/i.test(message) ||
    /unsafe archive path/i.test(message)
  );
}

function resolveRemoteSourceDirectory(sourceId: string) {
  return path.join(resolveStoreCatalogsRoot(), REMOTE_SOURCE_DIRNAME, sourceId);
}

function normalizeRemoteSourceName(url: string, preferredName?: string) {
  if (preferredName?.trim()) {
    return preferredName.trim();
  }

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = parts.at(-1)?.replace(/\.zip$/i, "") ?? parsed.hostname;
    return lastPart.length > 0 ? lastPart : parsed.hostname;
  } catch {
    return "Remote App Store";
  }
}

async function resolveConfiguredCatalogPath() {
  await ensureDataRootDirectories();
  const config = await readStoreCatalogConfig();
  return config?.defaultCatalogPath ?? defaultCatalogPath();
}

async function resolveAppsDirectory(repoPath: string) {
  for (const candidate of APPS_DIRECTORY_CANDIDATES) {
    const fullPath = path.join(repoPath, candidate);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  throw new Error(`CasaOS catalog apps directory not found in ${repoPath}`);
}

async function ensureCatalogRoot(directoryPath: string) {
  try {
    await resolveAppsDirectory(directoryPath);
    return directoryPath;
  } catch {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nestedRoot = path.join(directoryPath, entry.name);
      try {
        await resolveAppsDirectory(nestedRoot);
        return nestedRoot;
      } catch {
        // Keep searching.
      }
    }
  }

  throw new Error("Catalog archive must contain an Apps or Store directory");
}

/**
 * A `.git` entry is not proof of a usable checkout: an interrupted clone or a
 * partially cleaned directory leaves the subdirectories behind without HEAD or
 * config, and every git command there fails with "not a git repository".
 */
async function isGitRepository(directory: string) {
  try {
    await execFileAsync("git", ["-C", directory, "rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

async function cloneOfficialCatalogRepo(absoluteTarget: string) {
  await execFileAsync("git", ["clone", "--depth=1", CASAOS_APPSTORE_REPO_URL, absoluteTarget]);
}

async function ensureOfficialCatalogRepo(targetPath: string, options?: { forceSync?: boolean }) {
  const absoluteTarget = path.resolve(targetPath);

  await ensureDataRootDirectories();
  await mkdir(path.dirname(absoluteTarget), { recursive: true });

  if (!existsSync(absoluteTarget)) {
    await cloneOfficialCatalogRepo(absoluteTarget);
  } else if (options?.forceSync) {
    if (await isGitRepository(absoluteTarget)) {
      await execFileAsync("git", ["-C", absoluteTarget, "fetch", "--depth=1", "origin"]);
      await execFileAsync("git", ["-C", absoluteTarget, "reset", "--hard", "origin/HEAD"]);
    } else {
      // The catalog is a disposable mirror of a public repository, so replacing
      // an unusable checkout costs nothing and is what the user asked for by
      // pressing refresh. Without this the store stays broken for good.
      await rm(absoluteTarget, { recursive: true, force: true });
      await cloneOfficialCatalogRepo(absoluteTarget);
    }
  }

  await writeStoreCatalogConfig({
    defaultCatalogPath: absoluteTarget,
    repoUrl: CASAOS_APPSTORE_REPO_URL,
  });

  return absoluteTarget;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function collectComposePaths(appsDirectory: string) {
  const entries = await readdir(appsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDirectory, entry.name, "docker-compose.yml"))
    .filter((composePath) => existsSync(composePath))
    .sort((left, right) => left.localeCompare(right));
}

async function buildSignature(repoPath: string, composePaths: string[]) {
  const watchedFiles = [
    path.join(repoPath, "category-list.json"),
    path.join(repoPath, "featured-apps.json"),
    path.join(repoPath, "recommend-list.json"),
    ...composePaths,
  ];

  const parts = await Promise.all(
    watchedFiles.map(async (filePath) => {
      try {
        const info = await stat(filePath);
        return `${filePath}:${info.mtimeMs}:${info.size}`;
      } catch {
        return `${filePath}:missing`;
      }
    }),
  );

  return parts.join("|");
}

function mapCatalogApp(
  input: AppDefinition,
  repoPath: string,
  source: StoreCatalogSource,
): StoreCatalogTemplate {
  return {
    ...input,
    repositoryUrl: source.url,
    stackFile: path.relative(repoPath, input.composePath),
    sourceId: source.id,
    sourceName: source.name,
    sourceKind: source.kind,
  };
}

function buildCatalogCategories(input: {
  apps: StoreCatalogTemplate[];
  categoryEntries: CasaosCategoryEntry[];
  includeCustomCategory?: boolean;
}) {
  const counts = new Map<string, number>();
  for (const app of input.apps) {
    for (const category of app.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }

  const ordered: StoreCatalogCategory[] = [];
  for (const item of input.categoryEntries) {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    ordered.push({
      id: normalizeCategoryId(name),
      name,
      description:
        typeof item.description === "string" && item.description.trim().length > 0
          ? item.description.trim()
          : `${name} apps`,
      appCount: counts.get(name) ?? 0,
    });
  }

  const known = new Set(ordered.map((item) => item.name));
  for (const [name, appCount] of Array.from(counts.entries()).sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    if (known.has(name)) continue;
    ordered.push({
      id: normalizeCategoryId(name),
      name,
      description: `${name} apps`,
      appCount,
    });
  }

  if (input.includeCustomCategory && !ordered.some((item) => item.name === "Custom")) {
    ordered.push({
      id: normalizeCategoryId("Custom"),
      name: "Custom",
      description: "Custom compose apps",
      appCount: counts.get("Custom") ?? 0,
    });
  }

  return ordered.filter((item) => item.appCount > 0);
}

function normalizeReferences(entries: CasaosAppReference[]) {
  return entries
    .map((entry) => (typeof entry.appid === "string" ? entry.appid.trim() : ""))
    .filter((appid) => appid.length > 0);
}

async function buildSourceSnapshot(
  repoPath: string,
  source: StoreCatalogSource,
  options?: { bypassCache?: boolean },
): Promise<SourceSnapshot> {
  const cached = options?.bypassCache ? null : catalogCache.get(source.id);
  if (cached && Date.now() < cached.revalidateAfter) {
    return cached.snapshot;
  }

  const appsDirectory = await resolveAppsDirectory(repoPath);
  const composePaths = await collectComposePaths(appsDirectory);
  const signature = await buildSignature(repoPath, composePaths);
  if (cached && cached.signature === signature) {
    catalogCache.set(
      source.id,
      { ...cached, revalidateAfter: Date.now() + CATALOG_REVALIDATE_INTERVAL_MS },
      serverEnv.STORE_CATALOG_TTL_MS,
    );
    return cached.snapshot;
  }

  const [categoryEntries, featuredEntries, recommendedEntries] = await Promise.all([
    readJsonFile<CasaosCategoryEntry[]>(path.join(repoPath, "category-list.json"), []),
    readJsonFile<CasaosAppReference[]>(path.join(repoPath, "featured-apps.json"), []),
    readJsonFile<CasaosAppReference[]>(path.join(repoPath, "recommend-list.json"), []),
  ]);

  const apps = composePaths
    .map((composePath) => {
      try {
        return mapCatalogApp(parseComposeToApp(composePath), repoPath, source);
      } catch (error) {
        // A single broken upstream YAML (duplicate keys, malformed indentation,
        // etc.) used to crash the whole catalog bootstrap and take down
        // /api/auth/register. Log it and skip the entry so the rest of the
        // catalog still loads.
        logServerAction({
          level: "warn",
          layer: "service",
          action: "store.catalog.skip",
          status: "error",
          error,
          meta: { composePath, sourceId: source.id },
        });
        return null;
      }
    })
    .filter((app): app is NonNullable<typeof app> => app !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  const snapshot: SourceSnapshot = {
    source,
    apps,
    categoryEntries,
    featuredAppIds: normalizeReferences(featuredEntries),
    recommendedAppIds: normalizeReferences(recommendedEntries),
    sourcePath: repoPath,
  };

  catalogCache.set(
    source.id,
    {
      signature,
      snapshot,
      revalidateAfter: Date.now() + CATALOG_REVALIDATE_INTERVAL_MS,
    },
    serverEnv.STORE_CATALOG_TTL_MS,
  );
  return snapshot;
}

async function downloadRemoteCatalogArchive(source: StoreCatalogSource) {
  const parsedUrl = new URL(source.url);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Store source must use https");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "homeio-store-source-"));
  const zipPath = path.join(tempRoot, "catalog.zip");
  const extractRoot = resolveRemoteSourceDirectory(source.id);

  try {
    const response = await fetch(source.url, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Failed to download source (${response.status})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(zipPath, buffer);

    await rm(extractRoot, { recursive: true, force: true });
    await mkdir(extractRoot, { recursive: true });
    const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
    const archiveEntries = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    for (const entry of archiveEntries) {
      const sanitizedEntry = entry.replaceAll("\\", "/");
      if (sanitizedEntry.startsWith("/")) {
        throw new Error(`Unsafe archive path: ${entry}`);
      }

      const resolvedEntryPath = path.resolve(extractRoot, sanitizedEntry);
      const extractRootWithSeparator = `${path.resolve(extractRoot)}${path.sep}`;
      if (
        resolvedEntryPath !== path.resolve(extractRoot) &&
        !resolvedEntryPath.startsWith(extractRootWithSeparator)
      ) {
        throw new Error(`Unsafe archive path: ${entry}`);
      }
    }

    await execFileAsync("unzip", ["-oq", zipPath, "-d", extractRoot]);

    return await ensureCatalogRoot(extractRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function toSourceErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown store source error";
}

async function updateStoredSource(
  sourceId: string,
  updater: (source: StoreCatalogSource) => StoreCatalogSource,
) {
  return mutateStoreCatalogSources((sources) => {
    const source = sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error("Store source not found");
    }

    const updated = updater(source);
    return {
      sources: sources.map((entry) => (entry.id === sourceId ? updated : entry)),
      result: updated,
    };
  });
}

async function loadEnabledSourceSnapshots(options?: { bypassCache?: boolean }) {
  await ensureDataRootDirectories();
  const sources = await readStoreCatalogSources();
  const snapshots: SourceSnapshot[] = [];
  const effectiveSources: StoreCatalogSource[] = [];

  for (const source of sources) {
    if (!source.enabled) {
      effectiveSources.push(source);
      continue;
    }

    if (source.kind === "remote" && source.status === "error") {
      effectiveSources.push(source);
      continue;
    }

    try {
      let sourcePath = source.sourcePath;
      let nextSource = source;

      if (source.kind === "official") {
        sourcePath = await ensureOfficialCatalogRepo(source.sourcePath);
        if (sourcePath !== source.sourcePath) {
          nextSource = await updateStoredSource(source.id, (current) => ({
            ...current,
            sourcePath,
            updatedAt: new Date().toISOString(),
          }));
        }
      }

      const snapshot = await buildSourceSnapshot(sourcePath, { ...nextSource, sourcePath }, options);
      snapshots.push(snapshot);
      effectiveSources.push({ ...nextSource, sourcePath });
    } catch (error) {
      logServerAction({
        level: "warn",
        layer: "service",
        action: "store.catalog.snapshot",
        status: "error",
        message: `Skipping store source ${source.name}`,
        error,
        meta: {
          sourceId: source.id,
          sourceUrl: source.url,
        },
      });

      const failedSource =
        source.kind === "remote"
          ? await updateStoredSource(source.id, (current) => ({
              ...current,
              status: "error",
              lastError: toSourceErrorMessage(error),
              updatedAt: new Date().toISOString(),
            }))
          : source;

      effectiveSources.push(failedSource);
    }
  }

  return {
    sources: effectiveSources,
    snapshots,
  };
}

function mergeSourceSnapshots(input: {
  sources: StoreCatalogSource[];
  snapshots: SourceSnapshot[];
}): StoreCatalogSnapshot {
  const mergedApps = new Map<string, StoreCatalogTemplate>();
  const suppressedBySource = new Map<string, Set<string>>();
  const mergedCategoryEntries: CasaosCategoryEntry[] = [];
  const officialSnapshot = input.snapshots.find(
    (snapshot) => snapshot.source.id === OFFICIAL_STORE_SOURCE_ID,
  );

  for (const snapshot of input.snapshots) {
    mergedCategoryEntries.push(...snapshot.categoryEntries);

    for (const app of snapshot.apps) {
      const existing = mergedApps.get(app.appId);
      if (!existing) {
        mergedApps.set(app.appId, app);
        continue;
      }

      const winner =
        existing.sourceKind === "official" ||
        existing.sourceId === OFFICIAL_STORE_SOURCE_ID
          ? existing
          : app;
      const suppressedSourceId =
        winner.sourceId === existing.sourceId ? app.sourceId : existing.sourceId;

      if (!suppressedBySource.has(suppressedSourceId)) {
        suppressedBySource.set(suppressedSourceId, new Set());
      }
      suppressedBySource.get(suppressedSourceId)!.add(app.appId);
    }
  }

  const apps = Array.from(mergedApps.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  const sources = input.sources.map((source) => ({
    ...source,
    suppressedAppIds: Array.from(suppressedBySource.get(source.id) ?? []).sort((a, b) => a.localeCompare(b)),
  }));

  return {
    apps,
    categories: buildCatalogCategories({
      apps,
      categoryEntries: mergedCategoryEntries,
    }),
    featuredAppIds: officialSnapshot?.featuredAppIds ?? [],
    recommendedAppIds: officialSnapshot?.recommendedAppIds ?? [],
    sourcePath: officialSnapshot?.sourcePath ?? input.sources[0]?.sourcePath ?? defaultCatalogPath(),
    sources,
  };
}

export async function bootstrapDefaultCasaosCatalog(options?: { forceRefresh?: boolean }) {
  return withServerTiming(
    {
      layer: "service",
      action: "store.catalog.bootstrap",
      meta: { forceRefresh: Boolean(options?.forceRefresh) },
    },
    async () => {
      const configuredPath = await resolveConfiguredCatalogPath();
      const repoPath = await ensureOfficialCatalogRepo(configuredPath);

      if (options?.forceRefresh) {
        catalogCache.delete(OFFICIAL_STORE_SOURCE_ID);
      }

      const sources = await readStoreCatalogSources();
      const official =
        sources.find((source) => source.id === OFFICIAL_STORE_SOURCE_ID) ?? {
          id: OFFICIAL_STORE_SOURCE_ID,
          name: "Official CasaOS",
          url: CASAOS_APPSTORE_REPO_URL,
          kind: "official" as const,
          enabled: true,
          status: "ready" as const,
          sourcePath: repoPath,
          suppressedAppIds: [],
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
          lastError: null,
        };
      const snapshot = await buildSourceSnapshot(
        repoPath,
        { ...official, sourcePath: repoPath },
        { bypassCache: options?.forceRefresh },
      );

      return {
        path: repoPath,
        indexedApps: snapshot.apps.length,
      };
    },
  );
}

export async function listStoreCatalogSources() {
  const { sources, snapshots } = await loadEnabledSourceSnapshots();
  return mergeSourceSnapshots({ sources, snapshots }).sources;
}

export async function addStoreCatalogSource(input: { url: string; name?: string }) {
  return withServerTiming(
    {
      layer: "service",
      action: "store.catalog.source.add",
      meta: { url: input.url },
    },
    async () => {
      const parsedUrl = new URL(input.url);
      if (parsedUrl.protocol !== "https:") {
        throw new Error("Store source must use https");
      }

      const sourceId = randomUUID();
      const now = new Date().toISOString();
      const source: StoreCatalogSource = {
        id: sourceId,
        name: normalizeRemoteSourceName(input.url, input.name),
        url: input.url,
        kind: "remote",
        enabled: true,
        status: "syncing",
        sourcePath: resolveRemoteSourceDirectory(sourceId),
        suppressedAppIds: [],
        addedAt: now,
        updatedAt: now,
        lastSyncedAt: null,
        lastError: null,
      };

      await mutateStoreCatalogSources((sources) => {
        if (sources.some((entry) => entry.url === input.url)) {
          throw new Error("Store source already exists");
        }

        return { sources: [...sources, source], result: undefined };
      });

      return refreshStoreCatalogSource(sourceId);
    },
  );
}

export async function refreshStoreCatalogSource(sourceId: string) {
  return withServerTiming(
    {
      layer: "service",
      action: "store.catalog.source.refresh",
      meta: { sourceId },
    },
    async () => {
      const sources = await readStoreCatalogSources();
      const source = sources.find((entry) => entry.id === sourceId);
      if (!source) {
        throw new Error("Store source not found");
      }

      const syncingAt = new Date().toISOString();
      await updateStoredSource(sourceId, (current) => ({
        ...current,
        status: "syncing",
        lastError: null,
        updatedAt: syncingAt,
      }));

      try {
        let sourcePath = source.sourcePath;

        if (source.kind === "official") {
          sourcePath = await ensureOfficialCatalogRepo(source.sourcePath, { forceSync: true });
        } else {
          sourcePath = await downloadRemoteCatalogArchive(source);
        }

        catalogCache.delete(sourceId);
        await buildSourceSnapshot(sourcePath, { ...source, sourcePath }, { bypassCache: true });

        return updateStoredSource(sourceId, (current) => ({
          ...current,
          sourcePath,
          status: "ready",
          lastError: null,
          lastSyncedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
      } catch (error) {
        await updateStoredSource(sourceId, (current) => ({
          ...current,
          status: "error",
          lastError: toSourceErrorMessage(error),
          updatedAt: new Date().toISOString(),
        }));

        throw error;
      }
    },
  );
}

export { isStoreSourceClientError };

export async function updateStoreCatalogSource(sourceId: string, input: { enabled: boolean }) {
  if (sourceId === OFFICIAL_STORE_SOURCE_ID && !input.enabled) {
    throw new Error("Official store source cannot be disabled");
  }

  return withServerTiming(
    {
      layer: "service",
      action: "store.catalog.source.update",
      meta: { sourceId, enabled: input.enabled },
    },
    async () =>
      updateStoredSource(sourceId, (current) => ({
        ...current,
        enabled: input.enabled,
        updatedAt: new Date().toISOString(),
      })),
  );
}

export async function removeStoreCatalogSource(sourceId: string) {
  if (sourceId === OFFICIAL_STORE_SOURCE_ID) {
    throw new Error("Official store source cannot be removed");
  }

  return withServerTiming(
    {
      layer: "service",
      action: "store.catalog.source.remove",
      meta: { sourceId },
    },
    async () => {
      const source = await mutateStoreCatalogSources((sources) => {
        const existing = sources.find((entry) => entry.id === sourceId);
        if (!existing) {
          throw new Error("Store source not found");
        }

        return {
          sources: sources.filter((entry) => entry.id !== sourceId),
          result: existing,
        };
      });

      catalogCache.delete(sourceId);
      await rm(resolveRemoteSourceDirectory(sourceId), { recursive: true, force: true });

      return source;
    },
  );
}

export async function getStoreCatalogSnapshot(options?: { bypassCache?: boolean }) {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "store.catalog.snapshot",
      meta: { bypassCache: Boolean(options?.bypassCache) },
    },
    async () => {
      const { sources, snapshots } = await loadEnabledSourceSnapshots(options);
      return mergeSourceSnapshots({ sources, snapshots });
    },
  );
}

export async function listStoreCatalogTemplates(options?: { bypassCache?: boolean }) {
  const snapshot = await getStoreCatalogSnapshot(options);
  return snapshot.apps;
}

export async function findStoreCatalogTemplateByAppId(appId: string) {
  const apps = await listStoreCatalogTemplates();
  return apps.find((app) => app.appId === appId) ?? null;
}
