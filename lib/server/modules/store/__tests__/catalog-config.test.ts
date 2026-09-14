import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/storage/data-root", () => ({
  resolveDataRootDirectory: vi.fn(),
}));

import { resolveDataRootDirectory } from "@/lib/server/storage/data-root";

function buildRemoteSource(id: string) {
  return {
    id,
    name: "Community Store",
    url: `https://example.com/${id}.zip`,
    kind: "remote" as const,
    enabled: true,
    status: "ready" as const,
    sourcePath: `/DATA/AppStore/sources/${id}`,
    suppressedAppIds: [] as string[],
    addedAt: "2026-03-13T10:00:00.000Z",
    updatedAt: "2026-03-13T10:00:00.000Z",
    lastSyncedAt: "2026-03-13T10:00:00.000Z",
    lastError: null,
  };
}

describe("store catalog config", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "homeio-store-config-"));
    vi.mocked(resolveDataRootDirectory).mockReturnValue(tempRoot);
    await mkdir(path.join(tempRoot, "AppStore"), { recursive: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("migrates the legacy single-source config into an official registry source", async () => {
    await writeFile(
      path.join(tempRoot, "AppStore", "catalog-source.json"),
      JSON.stringify({
        defaultCatalogPath: "/DATA/AppStore/CasaOS-AppStore",
        repoUrl: "https://github.com/IceWhaleTech/CasaOS-AppStore",
        updatedAt: "2026-03-13T10:00:00.000Z",
      }),
      "utf8",
    );

    const { OFFICIAL_STORE_SOURCE_ID, readStoreCatalogSources } = await import(
      "@/lib/server/modules/store/catalog-config"
    );

    const sources = await readStoreCatalogSources();

    expect(sources).toEqual([
      expect.objectContaining({
        id: OFFICIAL_STORE_SOURCE_ID,
        kind: "official",
        enabled: true,
        sourcePath: "/DATA/AppStore/CasaOS-AppStore",
        url: "https://github.com/IceWhaleTech/CasaOS-AppStore",
      }),
    ]);
  });

  it("writes a versioned source registry and keeps the official source first", async () => {
    const { OFFICIAL_STORE_SOURCE_ID, writeStoreCatalogSources } = await import(
      "@/lib/server/modules/store/catalog-config"
    );

    await writeStoreCatalogSources([
      {
        id: "remote-1",
        name: "Community Store",
        url: "https://example.com/store.zip",
        kind: "remote",
        enabled: true,
        status: "ready",
        sourcePath: "/DATA/AppStore/sources/remote-1",
        suppressedAppIds: [],
        addedAt: "2026-03-13T10:00:00.000Z",
        updatedAt: "2026-03-13T10:00:00.000Z",
        lastSyncedAt: "2026-03-13T10:00:00.000Z",
        lastError: null,
      },
    ]);

    const persisted = JSON.parse(
      await readFile(path.join(tempRoot, "AppStore", "catalog-source.json"), "utf8"),
    ) as { version: number; sources: Array<{ id: string }> };

    expect(persisted.version).toBe(2);
    expect(persisted.sources[0]?.id).toBe(OFFICIAL_STORE_SOURCE_ID);
    expect(persisted.sources[1]?.id).toBe("remote-1");
  });

  it("keeps every source when mutations run concurrently", async () => {
    const { mutateStoreCatalogSources, readStoreCatalogSources } = await import(
      "@/lib/server/modules/store/catalog-config"
    );

    // Catalog snapshot loads, app installs and store search all mutate the
    // registry, and they overlap. Read-modify-write without a lock keeps only
    // the last writer's source.
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        mutateStoreCatalogSources((sources) => ({
          sources: [...sources, buildRemoteSource(`remote-${index}`)],
          result: undefined,
        })),
      ),
    );

    const persisted = await readStoreCatalogSources();
    expect(persisted.map((source) => source.id).sort()).toEqual([
      "official-casaos",
      "remote-0",
      "remote-1",
      "remote-2",
      "remote-3",
      "remote-4",
    ]);
  });

  it("keeps a concurrently added source when a slow reader updates its own", async () => {
    const { mutateStoreCatalogSources, readStoreCatalogSources } = await import(
      "@/lib/server/modules/store/catalog-config"
    );

    // A snapshot load reads the registry, then spends seconds scanning the
    // store on disk before it records the result of its own sync.
    const staleSources = await readStoreCatalogSources();
    expect(staleSources.map((source) => source.id)).not.toContain("remote-1");

    // Meanwhile the user adds a source, which lands on disk first.
    await mutateStoreCatalogSources((sources) => ({
      sources: [...sources, buildRemoteSource("remote-1")],
      result: undefined,
    }));

    // The slow reader finishes: its update must apply to the registry as it is
    // now, not to the list it captured before the add.
    await mutateStoreCatalogSources((sources) => ({
      sources: sources.map((source) =>
        source.id === "official-casaos"
          ? { ...source, updatedAt: "2026-03-13T11:00:00.000Z" }
          : source,
      ),
      result: undefined,
    }));

    const persisted = await readStoreCatalogSources();
    expect(persisted.map((source) => source.id)).toContain("remote-1");
  });

  it("does not fall back to the official source when the registry is unreadable", async () => {
    const registryPath = path.join(tempRoot, "AppStore", "catalog-source.json");
    const { readStoreCatalogSources, writeStoreCatalogSources } = await import(
      "@/lib/server/modules/store/catalog-config"
    );

    await writeStoreCatalogSources([buildRemoteSource("remote-1")]);

    // A torn write leaves truncated JSON behind.
    const raw = await readFile(registryPath, "utf8");
    await writeFile(registryPath, raw.slice(0, Math.floor(raw.length / 2)), "utf8");

    // Today this resolves to the official source alone, and the next write
    // persists that truncated list -- the user's source is gone for good.
    await expect(readStoreCatalogSources()).rejects.toThrow();
  });

  it("replaces the registry atomically and leaves no temp files behind", async () => {
    const { writeStoreCatalogSources } = await import(
      "@/lib/server/modules/store/catalog-config"
    );

    await writeStoreCatalogSources([buildRemoteSource("remote-1")]);

    const entries = await readdir(path.join(tempRoot, "AppStore"));
    expect(entries).toEqual(["catalog-source.json"]);
  });
});
