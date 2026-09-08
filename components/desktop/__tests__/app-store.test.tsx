/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppOperationState } from "@/modules/apps/hooks/useStoreActions";
import type { InstalledStackConfig, StoreAppDetail, StoreAppSummary } from "@/lib/shared/contracts/apps";
import { queryKeys } from "@/lib/shared/query-keys";
import { createTestQueryClient, createWrapper } from "@/test/query-client-wrapper";

const useStoreCatalogMock = vi.fn();
const useStoreAppMock = vi.fn();
const useStoreActionsMock = vi.fn();
const useInstalledAppsMock = vi.fn();
const useStoreOperationMock = vi.fn();
const useAppComposeMock = vi.fn();
const useStoreSourcesMock = vi.fn();
const useStoreSourceActionsMock = vi.fn();

vi.mock("@/modules/apps/hooks/useStoreCatalog", () => ({
  useStoreCatalog: (...args: unknown[]) => useStoreCatalogMock(...args),
}));

vi.mock("@/modules/apps/hooks/useStoreApp", () => ({
  useStoreApp: (...args: unknown[]) => useStoreAppMock(...args),
}));

vi.mock("@/modules/apps/hooks/useStoreActions", () => ({
  useStoreActions: (...args: unknown[]) => useStoreActionsMock(...args),
}));

vi.mock("@/modules/apps/hooks/useInstalledApps", () => ({
  useInstalledApps: (...args: unknown[]) => useInstalledAppsMock(...args),
}));

vi.mock("@/modules/apps/hooks/useStoreOperation", () => ({
  useStoreOperation: (...args: unknown[]) => useStoreOperationMock(...args),
}));

vi.mock("@/modules/apps/hooks/useAppCompose", () => ({
  useAppCompose: (...args: unknown[]) => useAppComposeMock(...args),
}));

vi.mock("@/modules/apps/hooks/useStoreSources", () => ({
  useStoreSources: (...args: unknown[]) => useStoreSourcesMock(...args),
  useStoreSourceActions: (...args: unknown[]) => useStoreSourceActionsMock(...args),
}));

import { AppStore } from "@/modules/apps/components/app-store";

const summaryApp: StoreAppSummary = {
  id: "plex",
  name: "Plex",
  description: "Media server",
  platform: "Docker",
  categories: ["Media"],
  logoUrl: "https://cdn.example.com/plex.png",
  heroImageUrl: "https://cdn.example.com/plex-hero.png",
  repositoryUrl: "https://github.com/plex",
  stackFile: "Apps/Plex/docker-compose.yml",
  status: "not_installed",
  webUiPort: null,
  updateAvailable: false,
  sourceId: "official-casaos",
  sourceName: "Official CasaOS",
  sourceKind: "official",
};

const installedSummaryApp: StoreAppSummary = {
  ...summaryApp,
  status: "installed",
  webUiPort: 32400,
};

const updatableSummaryApp: StoreAppSummary = {
  ...installedSummaryApp,
  updateAvailable: true,
  installedImage: "plexinc/pms-docker:1.41.2",
  image: "plexinc/pms-docker:1.41.3",
};

const installedConfig: InstalledStackConfig = {
  appId: "plex",
  templateName: "plex",
  stackName: "plex-stack",
  composePath: "/tmp/stacks/plex/docker-compose.yml",
  status: "installed",
  webUiPort: 32400,
  webUiUrl: null,
  env: {
    TZ: "UTC",
  },
  displayName: null,
  iconUrl: null,
  installedAt: "2026-02-23T10:00:00.000Z",
  updatedAt: "2026-02-23T10:00:00.000Z",
  isUpToDate: true,
  lastUpdateCheck: null,
};

const appDetail: StoreAppDetail = {
  ...installedSummaryApp,
  note: "Install Plex from CasaOS.",
  env: [
    {
      name: "TZ",
      label: "Timezone",
      default: "UTC",
      description: "Timezone used by the container",
    },
  ],
  screenshots: ["https://cdn.example.com/plex-shot.png"],
  installedConfig,
};

const updatableAppDetail: StoreAppDetail = {
  ...appDetail,
  ...updatableSummaryApp,
};

const installableAppDetail: StoreAppDetail = {
  ...appDetail,
  ...summaryApp,
  note: "Install Plex from CasaOS.",
};

function setup({
  apps = [summaryApp],
  detail = null,
  operationsByApp = {},
  categories = [{ id: "media", name: "Media", description: "Media apps", appCount: apps.length }],
  featuredAppIds = [apps[0]?.id].filter(Boolean) as string[],
  recommendedAppIds = [apps[0]?.id].filter(Boolean) as string[],
  onOpenCustomInstall = () => {},
}: {
  apps?: StoreAppSummary[];
  detail?: StoreAppDetail | null;
  operationsByApp?: Record<string, AppOperationState>;
  categories?: Array<{ id: string; name: string; description: string; appCount: number }>;
  featuredAppIds?: string[];
  recommendedAppIds?: string[];
  onOpenCustomInstall?: () => void;
} = {}) {
  const client = createTestQueryClient();
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const installApp = vi.fn().mockResolvedValue(undefined);
  const installCustomApp = vi.fn().mockResolvedValue(undefined);
  const updateApp = vi.fn().mockResolvedValue(undefined);
  const redeployApp = vi.fn().mockResolvedValue(undefined);
  const uninstallApp = vi.fn().mockResolvedValue(undefined);

  useStoreCatalogMock.mockReturnValue({
    data: {
      apps,
      categories,
      featuredAppIds,
      recommendedAppIds,
      sourcePath: "/DATA/AppStore/CasaOS-AppStore",
      sources: [
        {
          id: "official-casaos",
          name: "Official CasaOS",
          url: "https://github.com/IceWhaleTech/CasaOS-AppStore",
          kind: "official",
          enabled: true,
          status: "ready",
          sourcePath: "/DATA/AppStore/CasaOS-AppStore",
          suppressedAppIds: [],
          addedAt: "2026-02-23T10:00:00.000Z",
          updatedAt: "2026-02-23T10:00:00.000Z",
          lastSyncedAt: "2026-02-23T10:00:00.000Z",
          lastError: null,
        },
      ],
    },
    isLoading: false,
    isError: false,
  });
  useStoreAppMock.mockReturnValue({
    data: detail,
    isLoading: false,
  });
  useStoreActionsMock.mockReturnValue({
    operationsByApp,
    installApp,
    installCustomApp,
    updateApp,
    redeployApp,
    uninstallApp,
  });
  useStoreOperationMock.mockReturnValue({
    operation: null,
    latestEvent: null,
    isLoading: false,
    isError: false,
    error: null,
  });
  useInstalledAppsMock.mockReturnValue({
    data: apps.filter((app) => app.status !== "not_installed").map((app) => ({
      id: app.id,
      name: app.name,
      stackName: `${app.id}-stack`,
      composePath: `/tmp/stacks/${app.id}/docker-compose.yml`,
      webUiPort: app.webUiPort ?? null,
      containerName: app.id,
      status: "running",
      activeOperation: null,
      updatedAt: "2026-02-23T10:00:00.000Z",
    })),
    isLoading: false,
    isError: false,
  });
  useAppComposeMock.mockReturnValue({
    data: null,
    isLoading: false,
    isError: false,
    error: null,
  });
  useStoreSourcesMock.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  });
  useStoreSourceActionsMock.mockReturnValue({
    addSource: { mutateAsync: vi.fn(), isPending: false, variables: undefined },
    updateSource: { mutateAsync: vi.fn(), isPending: false, variables: undefined },
    refreshSource: { mutateAsync: vi.fn(), isPending: false, variables: undefined },
    removeSource: { mutateAsync: vi.fn(), isPending: false, variables: undefined },
  });

  render(<AppStore onOpenCustomInstall={onOpenCustomInstall} />, {
    wrapper: createWrapper(client),
  });

  return {
    client,
    invalidateSpy,
    installApp,
    installCustomApp,
    updateApp,
    redeployApp,
    uninstallApp,
  };
}

describe("AppStore", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );
    useStoreCatalogMock.mockReset();
    useStoreAppMock.mockReset();
    useStoreActionsMock.mockReset();
    useInstalledAppsMock.mockReset();
    useStoreOperationMock.mockReset();
    useAppComposeMock.mockReset();
    useStoreSourcesMock.mockReset();
    useStoreSourceActionsMock.mockReset();
  });

  it("refreshes update availability when the store opens", async () => {
    const fetchMock = vi.mocked(fetch);
    const { invalidateSpy } = setup();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/v1/store/check-updates", {
        method: "POST",
        cache: "no-store",
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.storeCatalog,
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.installedApps,
      });
    });
  });

  it("renders CasaOS catalog sections and the category filter", () => {
    setup();

    expect(screen.getAllByText("Plex").length).toBeGreaterThan(0);
    expect(screen.getAllByAltText("Plex").length).toBeGreaterThan(0);
    expect(screen.getByText("Featured")).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();

    // Categories are a row of pills, not a column. "All" rather than "All Apps",
    // which the toolbar already uses for the install-state tab.
    const filter = screen.getByRole("group", { name: "Filter by category" });
    expect(within(filter).getByRole("button", { name: "All" })).toBeTruthy();
    expect(within(filter).getByTitle("Media apps")).toBeTruthy();
  });

  it("opens the source management dialog from the install menu", async () => {
    useStoreSourcesMock.mockReturnValue({
      data: [
        {
          id: "official-casaos",
          name: "Official CasaOS",
          url: "https://github.com/IceWhaleTech/CasaOS-AppStore",
          kind: "official",
          enabled: true,
          status: "ready",
          sourcePath: "/DATA/AppStore/CasaOS-AppStore",
          suppressedAppIds: [],
          addedAt: "2026-02-23T10:00:00.000Z",
          updatedAt: "2026-02-23T10:00:00.000Z",
          lastSyncedAt: "2026-02-23T10:00:00.000Z",
          lastError: null,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    });

    setup();

    fireEvent.click(screen.getByRole("button", { name: "Install menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage Sources" }));

    await waitFor(() => {
      expect(screen.getByText("Store Sources")).toBeTruthy();
      expect(screen.getByLabelText("ZIP URL")).toBeTruthy();
    });
  });

  it("falls back to generic icon when logo fails", () => {
    setup();

    const image = screen.getAllByAltText("Plex")[0];
    fireEvent.error(image);

    expect(screen.getAllByLabelText("Plex").length).toBeGreaterThan(0);
  });

  it("triggers install action from app detail", () => {
    const { installApp } = setup({
      detail: installableAppDetail,
    });

    fireEvent.click(screen.getAllByRole("button", { name: /plex/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

    expect(installApp).toHaveBeenCalledWith({ appId: "plex" });
  });

  it("pages through every featured app rather than showing the first two", () => {
    const featured = ["plex", "jellyfin", "immich"].map((id, index) => ({
      ...summaryApp,
      id,
      name: `Featured ${index}`,
    }));

    setup({ apps: featured, featuredAppIds: featured.map((app) => app.id) });

    const hero = screen.getByRole("region", { name: "Featured apps" });
    for (const app of featured) {
      expect(
        within(hero).getByRole("button", { name: `View details for ${app.name}` }),
      ).toBeTruthy();
    }
    expect(within(hero).getByRole("button", { name: /more featured apps/i })).toBeTruthy();
  });

  it("installs straight from the catalog row without opening the detail panel", () => {
    const { installApp } = setup({
      detail: installableAppDetail,
    });

    const catalog = screen.getByRole("group", { name: "Catalog" });
    fireEvent.click(within(catalog).getByRole("button", { name: /^install$/i }));

    expect(installApp).toHaveBeenCalledWith({ appId: "plex" });
    // The row action must not be a shortcut into the detail view.
    expect(screen.queryByRole("button", { name: /back to store/i })).toBeNull();
  });

  it("keeps the catalog row to name, description and action", () => {
    setup({ apps: [installedSummaryApp] });

    const catalog = screen.getByRole("group", { name: "Catalog" });
    const row = within(catalog).getByRole("button", { name: /view details for plex/i });

    expect(within(row).getByText("Plex")).toBeTruthy();
    expect(within(row).getByText("Media server")).toBeTruthy();
    // Category, port and the official source belong to the detail panel.
    expect(within(row).queryByText("Media")).toBeNull();
    expect(within(row).queryByText(/32400/)).toBeNull();
    expect(within(row).queryByText("Official CasaOS")).toBeNull();
  });

  it("flags a source on the row only when it is not the official catalog", () => {
    setup({
      apps: [
        {
          ...installedSummaryApp,
          sourceId: "my-compose",
          sourceName: "My Compose",
          sourceKind: "custom",
        },
      ],
    });

    const catalog = screen.getByRole("group", { name: "Catalog" });
    const row = within(catalog).getByRole("button", { name: /view details for plex/i });

    expect(within(row).getByText("My Compose")).toBeTruthy();
  });

  it("keeps the row itself a way into the detail panel", () => {
    setup({ detail: installableAppDetail });

    const catalog = screen.getByRole("group", { name: "Catalog" });
    fireEvent.click(within(catalog).getByRole("button", { name: /view details for plex/i }));

    expect(screen.getByRole("button", { name: /back to store/i })).toBeTruthy();
  });

  it("uses installed apps query for the installed count badge", () => {
    useStoreCatalogMock.mockReturnValue({
      data: {
        apps: [summaryApp],
        categories: [{ id: "media", name: "Media", description: "Media apps", appCount: 1 }],
        featuredAppIds: [],
        recommendedAppIds: [],
        sourcePath: "/DATA/AppStore/CasaOS-AppStore",
        sources: [],
      },
      isLoading: false,
      isError: false,
    });
    useStoreAppMock.mockReturnValue({
      data: null,
      isLoading: false,
    });
    useStoreActionsMock.mockReturnValue({
      operationsByApp: {},
      installApp: vi.fn(),
      installCustomApp: vi.fn(),
      updateApp: vi.fn(),
      redeployApp: vi.fn(),
      uninstallApp: vi.fn(),
    });
    useStoreOperationMock.mockReturnValue({
      operation: null,
      latestEvent: null,
      isLoading: false,
      isError: false,
      error: null,
    });
    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          stackName: "plex-stack",
          composePath: "/tmp/stacks/plex/docker-compose.yml",
          webUiPort: 32400,
          containerName: "plex",
          status: "running",
          activeOperation: null,
          updatedAt: "2026-02-23T10:00:00.000Z",
        },
        {
          id: "jellyfin",
          name: "Jellyfin",
          stackName: "jellyfin-stack",
          composePath: "/tmp/stacks/jellyfin/docker-compose.yml",
          webUiPort: 8096,
          containerName: "jellyfin",
          status: "running",
          activeOperation: null,
          updatedAt: "2026-02-23T10:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });
    useAppComposeMock.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });
    useStoreSourcesMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    });
    useStoreSourceActionsMock.mockReturnValue({
      addSource: { mutateAsync: vi.fn(), isPending: false, variables: undefined },
      updateSource: { mutateAsync: vi.fn(), isPending: false, variables: undefined },
      refreshSource: { mutateAsync: vi.fn(), isPending: false, variables: undefined },
      removeSource: { mutateAsync: vi.fn(), isPending: false, variables: undefined },
    });

    const client = createTestQueryClient();
    render(<AppStore onOpenCustomInstall={() => {}} />, {
      wrapper: createWrapper(client),
    });

    expect(screen.getByRole("button", { name: "Installed (2)" })).toBeTruthy();
  });

  it("triggers uninstall from detail actions", async () => {
    const { uninstallApp } = setup({
      apps: [installedSummaryApp],
      detail: appDetail,
      featuredAppIds: [],
      recommendedAppIds: [],
    });

    fireEvent.click(screen.getAllByRole("button", { name: /plex/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /uninstall/i }));

    expect(screen.getByText("Screenshots")).toBeTruthy();
    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.getByText("Docker")).toBeTruthy();
    expect(screen.getByText("https://github.com/plex")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "Uninstall Plex?")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Uninstall" }).at(-1)!);

    await waitFor(() => {
      expect(uninstallApp).toHaveBeenCalledWith({
        appId: "plex",
        removeVolumes: false,
      });
    });
  });

  it("shows update action and triggers update when update is available", () => {
    const { updateApp } = setup({
      apps: [updatableSummaryApp],
      detail: updatableAppDetail,
      featuredAppIds: [],
      recommendedAppIds: [],
    });

    fireEvent.click(screen.getByRole("button", { name: /plex/i }));
    const detailUpdateButton = screen.getByRole("button", { name: /^update$/i });
    fireEvent.click(detailUpdateButton);

    expect(screen.getByText("Update available")).toBeTruthy();
    expect(updateApp).toHaveBeenCalledWith({ appId: "plex" });
  });

  it("opens custom install settings panel from app detail", () => {
    setup({
      apps: [installedSummaryApp],
      detail: appDetail,
      featuredAppIds: [],
      recommendedAppIds: [],
    });

    fireEvent.click(screen.getByRole("button", { name: /plex/i }));
    fireEvent.click(screen.getByRole("button", { name: /^custom$/i }));

    expect(screen.getByText("Install Plex")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /close configurator/i }));
    expect(screen.queryByText("Install Plex")).toBeNull();
  });
});
