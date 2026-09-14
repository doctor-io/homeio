import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const findInstalledStackByAppIdMock = vi.fn();
const dbExecuteMock = vi.fn();
const returningMock = vi.fn();

vi.mock("@/lib/server/modules/apps/stacks-repository", () => ({
  findInstalledStackByAppId: (...args: unknown[]) => findInstalledStackByAppIdMock(...args),
}));

vi.mock("@/lib/server/db/drizzle", () => ({
  db: {
    execute: (...args: unknown[]) => dbExecuteMock(...args),
    delete: () => ({ where: () => ({ returning: () => returningMock() }) }),
  },
}));

import { deleteCustomStoreTemplate } from "@/lib/server/modules/store/custom-apps";

describe("deleteCustomStoreTemplate", () => {
  beforeEach(() => {
    findInstalledStackByAppIdMock.mockReset();
    returningMock.mockReset();
    dbExecuteMock.mockReset();
    dbExecuteMock.mockResolvedValue({ rows: [{ table_exists: "custom_store_apps" }] });
  });

  it("refuses to remove the definition of an installed app", async () => {
    // The definition is what redeploys and updates read from, so dropping it
    // under a running stack would strand it.
    findInstalledStackByAppIdMock.mockResolvedValue({ appId: "plex", status: "installed" });

    await expect(deleteCustomStoreTemplate("plex")).rejects.toThrow(
      /Uninstall this app before removing/i,
    );
    expect(returningMock).not.toHaveBeenCalled();
  });

  it("removes a leftover definition that was never installed", async () => {
    findInstalledStackByAppIdMock.mockResolvedValue(null);
    returningMock.mockResolvedValue([
      {
        appId: "custom-leftover",
        name: "Leftover",
        iconUrl: null,
        webUiUrl: null,
        sourceType: "docker-compose",
        sourceText: "services: {}",
        composeContent: "services:\n  app:\n    image: nginx:alpine\n",
        repositoryUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const removed = await deleteCustomStoreTemplate("custom-leftover");
    expect(removed.isCustom).toBe(true);
  });

  it("reports a missing definition rather than succeeding quietly", async () => {
    findInstalledStackByAppIdMock.mockResolvedValue(null);
    returningMock.mockResolvedValue([]);

    await expect(deleteCustomStoreTemplate("nope")).rejects.toThrow(/not found/i);
  });
});
