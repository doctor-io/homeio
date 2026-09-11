import "server-only";

import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { StoreCatalogSource } from "@/lib/shared/contracts/apps";
import { resolveDataRootDirectory } from "@/lib/server/storage/data-root";

const STORE_CONFIG_DIRNAME = "AppStore";
const STORE_CONFIG_FILENAME = "catalog-source.json";

export const OFFICIAL_STORE_SOURCE_ID = "official-casaos";

export type StoreCatalogConfig = {
  defaultCatalogPath: string;
  repoUrl: string;
  updatedAt: string;
};

type StoreCatalogRegistry = {
  version: 2;
  sources: StoreCatalogSource[];
};

export function resolveStoreConfigDirectory() {
  return path.join(resolveDataRootDirectory(), STORE_CONFIG_DIRNAME);
}

export function resolveStoreCatalogConfigPath() {
  return path.join(resolveStoreConfigDirectory(), STORE_CONFIG_FILENAME);
}

/**
 * Every mutation of the registry is a read-modify-write, and the callers that
 * trigger them (catalog snapshot loads, app installs, store search) run
 * concurrently. Without this queue a slow reader writes back the list it read
 * seconds earlier and silently drops sources added in the meantime.
 */
let registryQueue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = registryQueue.then(operation, operation);
  registryQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isStoreCatalogSource(input: unknown): input is StoreCatalogSource {
  const value = input as Partial<StoreCatalogSource>;
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string" &&
    (value.kind === "official" || value.kind === "remote") &&
    typeof value.enabled === "boolean" &&
    (value.status === "ready" || value.status === "syncing" || value.status === "error") &&
    typeof value.sourcePath === "string" &&
    Array.isArray(value.suppressedAppIds) &&
    typeof value.addedAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.lastSyncedAt === null || typeof value.lastSyncedAt === "string") &&
    (value.lastError === null || typeof value.lastError === "string")
  );
}

function normalizeSource(source: StoreCatalogSource): StoreCatalogSource {
  return {
    ...source,
    sourcePath: path.resolve(source.sourcePath),
    suppressedAppIds: Array.from(new Set(source.suppressedAppIds)),
  };
}

function toOfficialConfigSource(input?: StoreCatalogConfig | null): StoreCatalogSource {
  const defaultCatalogPath = path.resolve(
    input?.defaultCatalogPath ?? path.join(resolveStoreConfigDirectory(), "CasaOS-AppStore"),
  );
  const updatedAt = input?.updatedAt ?? new Date(0).toISOString();

  return {
    id: OFFICIAL_STORE_SOURCE_ID,
    name: "Official CasaOS",
    url: input?.repoUrl ?? "https://github.com/IceWhaleTech/CasaOS-AppStore",
    kind: "official",
    enabled: true,
    status: "ready",
    sourcePath: defaultCatalogPath,
    suppressedAppIds: [],
    addedAt: updatedAt,
    updatedAt,
    lastSyncedAt: updatedAt,
    lastError: null,
  };
}

function parseLegacyConfig(raw: string): StoreCatalogConfig | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoreCatalogConfig>;

    if (
      typeof parsed.defaultCatalogPath !== "string" ||
      parsed.defaultCatalogPath.trim().length === 0 ||
      typeof parsed.repoUrl !== "string" ||
      parsed.repoUrl.trim().length === 0
    ) {
      return null;
    }

    return {
      defaultCatalogPath: parsed.defaultCatalogPath,
      repoUrl: parsed.repoUrl,
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

type ParsedRegistry = StoreCatalogRegistry & {
  /** Entries that did not match the expected shape and were not kept. */
  dropped: number;
};

function parseRegistry(raw: string): ParsedRegistry | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoreCatalogRegistry>;
    if (parsed.version !== 2 || !Array.isArray(parsed.sources)) {
      return null;
    }

    const sources = parsed.sources.filter(isStoreCatalogSource).map(normalizeSource);
    return {
      version: 2,
      sources,
      dropped: parsed.sources.length - sources.length,
    };
  } catch {
    return null;
  }
}

function ensureOfficialSource(sources: StoreCatalogSource[]) {
  const existingOfficial = sources.find((source) => source.id === OFFICIAL_STORE_SOURCE_ID);
  const remainder = sources.filter((source) => source.id !== OFFICIAL_STORE_SOURCE_ID);

  return [
    normalizeSource(
      existingOfficial ??
        toOfficialConfigSource({
          defaultCatalogPath: path.join(resolveStoreConfigDirectory(), "CasaOS-AppStore"),
          repoUrl: "https://github.com/IceWhaleTech/CasaOS-AppStore",
          updatedAt: new Date(0).toISOString(),
        }),
    ),
    ...remainder.map(normalizeSource),
  ];
}

/**
 * Keep a copy of a registry we could not parse. The original stays in place on
 * purpose: reads keep failing until someone looks at it, which is the point.
 * Recovering by returning the official source alone would let the next write
 * persist that truncated list and destroy the user's sources for good.
 */
async function quarantineRegistry() {
  const configPath = resolveStoreCatalogConfigPath();
  try {
    await copyFile(configPath, `${configPath}.corrupt`);
  } catch {
    // Best effort -- the throw below is what matters.
  }
}

async function loadRegistry(): Promise<StoreCatalogSource[]> {
  const configPath = resolveStoreCatalogConfigPath();
  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // No registry yet: a fresh install legitimately has only the official source.
      return ensureOfficialSource([]);
    }
    throw error;
  }

  const registry = parseRegistry(raw);
  if (registry) {
    if (registry.dropped > 0) {
      // Silently keeping the survivors would let the next write delete the rest.
      await quarantineRegistry();
      throw new Error(
        `Store source registry at ${configPath} has ${registry.dropped} entr` +
          `${registry.dropped === 1 ? "y" : "ies"} in an unexpected shape. A copy was kept at ` +
          `${configPath}.corrupt. Refusing to continue so they are not lost.`,
      );
    }

    return ensureOfficialSource(registry.sources);
  }

  const legacy = parseLegacyConfig(raw);
  if (legacy) {
    return ensureOfficialSource([toOfficialConfigSource(legacy)]);
  }

  await quarantineRegistry();
  throw new Error(
    `Unreadable store source registry at ${configPath}. A copy was kept at ` +
      `${configPath}.corrupt. Refusing to continue so the configured sources are not lost.`,
  );
}

async function persistRegistry(sources: StoreCatalogSource[]) {
  const registry: StoreCatalogRegistry = {
    version: 2,
    sources: ensureOfficialSource(sources),
  };

  const configPath = resolveStoreCatalogConfigPath();
  const tempPath = `${configPath}.${randomUUID()}.tmp`;

  await mkdir(resolveStoreConfigDirectory(), { recursive: true });

  // Write then rename: a reader sees either the old registry or the new one,
  // never a half-written file.
  try {
    await writeFile(tempPath, JSON.stringify(registry, null, 2), "utf8");
    await rename(tempPath, configPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  return registry.sources;
}

export async function readStoreCatalogSources(): Promise<StoreCatalogSource[]> {
  return loadRegistry();
}

export async function writeStoreCatalogSources(sources: StoreCatalogSource[]) {
  return runExclusive(() => persistRegistry(sources));
}

/**
 * Read-modify-write the registry under the lock. Callers that need to change a
 * single source must use this rather than read + write separately, so their
 * update cannot clobber a concurrent one.
 */
export async function mutateStoreCatalogSources<T>(
  mutator: (sources: StoreCatalogSource[]) => { sources: StoreCatalogSource[]; result: T },
): Promise<T> {
  return runExclusive(async () => {
    const current = await loadRegistry();
    const { sources, result } = mutator(current);
    await persistRegistry(sources);
    return result;
  });
}

export async function readStoreCatalogConfig(): Promise<StoreCatalogConfig | null> {
  const sources = await readStoreCatalogSources();
  const official = sources.find((source) => source.id === OFFICIAL_STORE_SOURCE_ID);
  if (!official) return null;

  return {
    defaultCatalogPath: official.sourcePath,
    repoUrl: official.url,
    updatedAt: official.updatedAt,
  };
}

export async function writeStoreCatalogConfig(input: {
  defaultCatalogPath: string;
  repoUrl: string;
}) {
  const official = toOfficialConfigSource({
    defaultCatalogPath: path.resolve(input.defaultCatalogPath),
    repoUrl: input.repoUrl,
    updatedAt: new Date().toISOString(),
  });

  return mutateStoreCatalogSources((sources) => ({
    sources: [official, ...sources.filter((source) => source.id !== OFFICIAL_STORE_SOURCE_ID)],
    result: {
      defaultCatalogPath: official.sourcePath,
      repoUrl: official.url,
      updatedAt: official.updatedAt,
    },
  }));
}

export function resolveStoreCatalogsRoot() {
  return resolveStoreConfigDirectory();
}
