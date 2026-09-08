import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db/drizzle", () => ({
  db: {
    execute: vi.fn(),
    select: vi.fn(),
  },
}));

import { db } from "@/lib/server/db/drizzle";
import { listInstalledAppsFromDb } from "@/lib/server/modules/apps/repository";

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit", "innerJoin"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve);
  chain.catch = (reject: (r: unknown) => unknown) =>
    Promise.resolve(rows).catch(reject);
  chain.finally = (cb: () => void) => Promise.resolve(rows).finally(cb);
  return chain;
}

describe("apps repository", () => {
  beforeEach(() => {
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.select).mockReset();
  });

  it("returns empty list when app_stacks table is not present", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [{ table_exists: null }],
    } as never);

    const result = await listInstalledAppsFromDb();

    expect(result).toEqual([]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("maps db rows to installed apps contract", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [{ table_exists: "app_stacks" }],
    } as never);

    vi.mocked(db.select).mockReturnValue(
      makeSelectChain([
        {
          appId: "plex",
          templateName: "plex",
          stackName: "plex-stack",
          composePath: "/DATA/AppData/plex/docker-compose.yml",
          displayName: "Plex Media Server",
          updatedAt: new Date("2026-02-22T12:00:00.000Z"),
        },
        {
          appId: "home-assistant",
          templateName: "home-assistant",
          stackName: "home-assistant",
          composePath: "/DATA/AppData/home-assistant/docker-compose.yml",
          displayName: null,
          updatedAt: "2026-02-22T12:10:00.000Z",
        },
      ]) as never,
    );

    const result = await listInstalledAppsFromDb();

    expect(result).toEqual([
      {
        id: "plex",
        name: "Plex Media Server",
        stackName: "plex-stack",
        composePath: "/DATA/AppData/plex/docker-compose.yml",
        status: "unknown",
        updatedAt: "2026-02-22T12:00:00.000Z",
        webUiPort: undefined,
        webUiUrl: null,
        activeOperation: null,
      },
      {
        id: "home-assistant",
        name: "home-assistant",
        stackName: "home-assistant",
        composePath: "/DATA/AppData/home-assistant/docker-compose.yml",
        status: "unknown",
        updatedAt: "2026-02-22T12:10:00.000Z",
        webUiPort: undefined,
        webUiUrl: null,
        activeOperation: null,
      },
    ]);
  });
});
