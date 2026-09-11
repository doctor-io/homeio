import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/store/catalog-config", () => ({
  OFFICIAL_STORE_SOURCE_ID: "official-casaos",
  readStoreCatalogConfig: vi.fn(),
  readStoreCatalogSources: vi.fn(),
  resolveStoreCatalogsRoot: vi.fn(() => "/tmp"),
  writeStoreCatalogConfig: vi.fn(),
  writeStoreCatalogSources: vi.fn(),
}));

vi.mock("@/lib/server/storage/data-root", () => ({
  ensureDataRootDirectories: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof FsPromises>("node:fs/promises");
  return { ...actual, stat: vi.fn(actual.stat) };
});

import {
  readStoreCatalogConfig,
  readStoreCatalogSources,
} from "@/lib/server/modules/store/catalog-config";
import { ensureDataRootDirectories } from "@/lib/server/storage/data-root";

describe("store catalog", () => {
  let repoRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "casaos-catalog-"));
    await mkdir(path.join(repoRoot, "Apps", "AdGuardHome"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "Apps", "AdGuardHome", "docker-compose.yml"),
      `name: adguardhome
services:
  adguardhome:
    image: adguard/adguardhome:v1
    ports:
      - "3001:3000"
x-casaos:
  main: adguardhome
  category: Network
  title:
    en_us: AdGuard Home
  description:
    en_us: Network DNS blocker
  icon: https://example.com/logo.png
  screenshot_link:
    - https://example.com/screenshot.png
  tips:
    before_install:
      en_us: Read this first
  scheme: http
  index: /
  port_map: "3001"
`,
      "utf8",
    );
    await writeFile(
      path.join(repoRoot, "category-list.json"),
      JSON.stringify([{ name: "Network", description: "Network apps" }]),
      "utf8",
    );
    await writeFile(
      path.join(repoRoot, "featured-apps.json"),
      JSON.stringify([{ appid: "adguardhome" }]),
      "utf8",
    );
    await writeFile(
      path.join(repoRoot, "recommend-list.json"),
      JSON.stringify([{ appid: "adguardhome" }]),
      "utf8",
    );
    vi.mocked(readStoreCatalogConfig).mockResolvedValue({
      defaultCatalogPath: repoRoot,
      repoUrl: "https://github.com/IceWhaleTech/CasaOS-AppStore",
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(readStoreCatalogSources).mockResolvedValue([
      {
        id: "official-casaos",
        name: "Official CasaOS",
        url: "https://github.com/IceWhaleTech/CasaOS-AppStore",
        kind: "official",
        enabled: true,
        status: "ready",
        sourcePath: repoRoot,
        suppressedAppIds: [],
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("indexes CasaOS compose apps from the local catalog checkout", async () => {
    const { getStoreCatalogSnapshot } = await import("@/lib/server/modules/store/catalog");
    const snapshot = await getStoreCatalogSnapshot({ bypassCache: true });

    expect(ensureDataRootDirectories).toHaveBeenCalled();
    expect(snapshot.apps).toHaveLength(1);
    expect(snapshot.apps[0]).toMatchObject({
      appId: "adguardhome",
      name: "AdGuard Home",
      description: "Network DNS blocker",
      categories: ["Network"],
      repositoryUrl: "https://github.com/IceWhaleTech/CasaOS-AppStore",
      stackFile: "Apps/AdGuardHome/docker-compose.yml",
      port: 3001,
      screenshots: ["https://example.com/screenshot.png"],
    });
    expect(snapshot.categories).toEqual([
      {
        id: "network",
        name: "Network",
        description: "Network apps",
        appCount: 1,
      },
    ]);
    expect(snapshot.featuredAppIds).toEqual(["adguardhome"]);
    expect(snapshot.recommendedAppIds).toEqual(["adguardhome"]);
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.apps[0]).toMatchObject({
      sourceId: "official-casaos",
      sourceKind: "official",
      sourceName: "Official CasaOS",
    });
  });

  it("does not re-stat the catalog on every request", async () => {
    // buildSignature stats one file per app. Doing that per request pegged the
    // CPU on real catalogs (~1000 apps) — every App Store search keystroke
    // walked the whole store before the cache was even consulted.
    const { getStoreCatalogSnapshot } = await import("@/lib/server/modules/store/catalog");
    const { stat } = await import("node:fs/promises");

    await getStoreCatalogSnapshot();
    const statCallsAfterFirst = vi.mocked(stat).mock.calls.length;
    expect(statCallsAfterFirst).toBeGreaterThan(0);

    await getStoreCatalogSnapshot();
    expect(vi.mocked(stat).mock.calls.length).toBe(statCallsAfterFirst);
  });

  it("still picks up on-disk changes once the revalidation window elapses", async () => {
    vi.useFakeTimers();

    try {
      const { getStoreCatalogSnapshot } = await import("@/lib/server/modules/store/catalog");

      const first = await getStoreCatalogSnapshot();
      expect(first.apps).toHaveLength(1);

      await mkdir(path.join(repoRoot, "Apps", "Jellyfin"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "Apps", "Jellyfin", "docker-compose.yml"),
        `name: jellyfin
services:
  jellyfin:
    image: jellyfin/jellyfin:v1
x-casaos:
  main: jellyfin
  category: Media
  title:
    en_us: Jellyfin
  description:
    en_us: Media server
  icon: https://example.com/jellyfin.png
  scheme: http
  index: /
  port_map: "8096"
`,
        "utf8",
      );

      // Still cached — the new app must not appear yet.
      expect((await getStoreCatalogSnapshot()).apps).toHaveLength(1);

      vi.advanceTimersByTime(31_000);
      expect((await getStoreCatalogSnapshot()).apps).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
