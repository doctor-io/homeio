import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    STORE_STACKS_ROOT: "/var/lib/home-server/stacks",
    STORE_APP_DATA_ROOT: "/DATA/AppData",
  },
}));

vi.mock("@/lib/server/env", () => ({
  serverEnv: serverEnvMock,
}));

describe("data-root storage resolution", () => {
  it("preserves the configured stacks root when the resolved data root matches the primary root", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
    }));

    const dataRootModule = await import("@/lib/server/storage/data-root");

    await dataRootModule.ensureDataRootDirectories();

    expect(dataRootModule.resolveStoreStacksRoot()).toBe(
      "/var/lib/home-server/stacks",
    );
  });

  it("falls back to a CWD-relative DATA root when the primary root cannot be created", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      mkdir: vi
        .fn()
        .mockRejectedValueOnce(new Error("permission denied"))
        .mockResolvedValue(undefined),
    }));

    const dataRootModule = await import("@/lib/server/storage/data-root");

    await dataRootModule.ensureDataRootDirectories();

    // Fallback resolves to <cwd>/DATA/Apps (since configured stacks root doesn't match fallback)
    expect(dataRootModule.resolveStoreStacksRoot()).toBe(
      path.join(process.cwd(), "DATA", "Apps"),
    );
  });

  it("uses the mounted /DATA in the Docker layout, where stacks sit at /stacks", async () => {
    vi.resetModules();
    const mkdir = vi.fn().mockResolvedValue(undefined);
    vi.doMock("node:fs/promises", () => ({ mkdir }));
    vi.doMock("node:fs", () => ({ existsSync: (target: string) => target === "/DATA/AppData/jellyfin" }));
    serverEnvMock.STORE_STACKS_ROOT = "/stacks";
    try {
      const dataRootModule = await import("@/lib/server/storage/data-root");
      await dataRootModule.ensureDataRootDirectories();

      expect(dataRootModule.resolveDataRootDirectory()).toBe("/DATA");
      expect(dataRootModule.resolveStoreStacksRoot()).toBe("/stacks");
      expect(dataRootModule.resolveStoreAppDataRoot()).toBe("/DATA/AppData");
      expect(mkdir).not.toHaveBeenCalledWith("/AppData", expect.anything());
      // Installed since the fix: its folder is in /DATA. Installed by 1.11.1: it stays under /app/DATA.
      expect(dataRootModule.resolveInstalledAppDataRoot("jellyfin")).toBe("/DATA/AppData");
      expect(dataRootModule.resolveInstalledAppDataRoot("plex")).toBe(path.resolve(process.cwd(), "DATA", "AppData"));
    } finally {
      serverEnvMock.STORE_STACKS_ROOT = "/var/lib/home-server/stacks";
      vi.doUnmock("node:fs");
    }
  });

  it("keeps installed apps in the configured folder on a bare-metal install", async () => {
    vi.resetModules();
    vi.doMock("node:fs", () => ({ existsSync: () => false }));
    const dataRootModule = await import("@/lib/server/storage/data-root");
    expect(dataRootModule.resolveInstalledAppDataRoot("plex")).toBe("/DATA/AppData");
    vi.doUnmock("node:fs");
  });
});
