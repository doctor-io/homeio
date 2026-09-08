/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const useStoreActionsMock = vi.fn();
const useInstalledAppsMock = vi.fn();
const useStoreCatalogMock = vi.fn();

vi.mock("@/modules/apps/hooks/useStoreActions", () => ({
  useStoreActions: (...args: unknown[]) => useStoreActionsMock(...args),
}));
vi.mock("@/modules/apps/hooks/useInstalledApps", () => ({
  useInstalledApps: (...args: unknown[]) => useInstalledAppsMock(...args),
}));
vi.mock("@/modules/apps/hooks/useStoreCatalog", () => ({
  useStoreCatalog: (...args: unknown[]) => useStoreCatalogMock(...args),
}));

import { AppGrid } from "@/modules/apps/components/app-grid";

function openContextMenuFor(appName: string) {
  const iconButton = screen.getByRole("button", { name: `Open ${appName}` });
  fireEvent.contextMenu(iconButton, { clientX: 120, clientY: 120 });
}

describe("AppGrid context menu", () => {
  beforeEach(() => {
    useStoreActionsMock.mockReset();
    useInstalledAppsMock.mockReset();
    useStoreCatalogMock.mockReset();

    useStoreActionsMock.mockReturnValue({
      operationsByApp: {},
      uninstallApp: vi.fn().mockResolvedValue(undefined),
      startApp: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      stopApp: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      restartApp: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      checkAppUpdates: vi.fn().mockReturnValue(new Promise<never>(() => {})),
    });
    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          status: "running",
          webUiPort: 32400,
          containerName: "plex",
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });
    useStoreCatalogMock.mockReturnValue({
      data: {
        apps: [
          {
            id: "plex",
            name: "Plex",
            description: "Plex media server",
            platform: "linux",
            categories: ["Media"],
            logoUrl: null,
            repositoryUrl: "https://example.com",
            stackFile: "Apps/plex/docker-compose.yml",
            status: "installed",
            webUiPort: 32400,
            updateAvailable: false,
            localDigest: null,
            remoteDigest: null,
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
  });

  it("opens dashboard with default url mapping", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Open Dashboard" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "http://localhost:32400",
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("prefers installed runtime port over catalog port for dashboard url", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          status: "running",
          webUiPort: 32410,
          containerName: "plex",
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Open Dashboard" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "http://localhost:32410",
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("opens the operator-set link instead of the browser-derived one", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          status: "running",
          webUiPort: 32400,
          webUiUrl: "https://plex.example.com",
          containerName: "plex",
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Open Dashboard" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://plex.example.com",
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("routes open dashboard through callback when provided", async () => {
    const onOpenDashboard = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <AppGrid
        animationsEnabled={false}
        onOpenDashboard={onOpenDashboard}
      />,
    );

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Open Dashboard" }));

    await waitFor(() => {
      expect(onOpenDashboard).toHaveBeenCalledWith({
        appId: "plex",
        appName: "Plex",
        dashboardUrl: "http://localhost:32400",
        containerName: "plex",
      });
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("opens dashboard without backend lookup", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Open Dashboard" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "http://localhost:32400",
        "_blank",
        "noopener,noreferrer",
      );
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("routes logs, terminal, and settings actions through callbacks", async () => {
    const onViewLogs = vi.fn();
    const onOpenTerminal = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <AppGrid
        animationsEnabled={false}
        onViewLogs={onViewLogs}
        onOpenTerminal={onOpenTerminal}
        onOpenSettings={onOpenSettings}
      />,
    );

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "View Logs" }));
    await waitFor(() => {
      expect(onViewLogs).toHaveBeenCalledWith({
        appId: "plex",
        appName: "Plex",
        dashboardUrl: "http://localhost:32400",
        containerName: "plex",
      });
    });

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Open in Terminal" }));
    await waitFor(() => {
      expect(onOpenTerminal).toHaveBeenCalledWith({
        appId: "plex",
        appName: "Plex",
        dashboardUrl: "http://localhost:32400",
        containerName: "plex",
      });
    });

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "App Settings" }));
    await waitFor(() => {
      expect(onOpenSettings).toHaveBeenCalledWith({
        appId: "plex",
        appName: "Plex",
        dashboardUrl: "http://localhost:32400",
        containerName: "plex",
      });
    });
  });

  it("does not route logs or terminal when container cannot be resolved", async () => {
    const onViewLogs = vi.fn();
    const onOpenTerminal = vi.fn();

    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          status: "running",
          webUiPort: 32400,
          containerName: null,
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });

    render(
      <AppGrid
        animationsEnabled={false}
        onViewLogs={onViewLogs}
        onOpenTerminal={onOpenTerminal}
      />,
    );

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "View Logs" }));

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Open in Terminal" }));
    expect(onViewLogs).not.toHaveBeenCalled();
    expect(onOpenTerminal).not.toHaveBeenCalled();
  });

  it("copies dashboard url with clipboard fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("http://localhost:32400");
    });
  });

  it("toggles stop/start container actions", () => {
    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Stop Container" }));

    openContextMenuFor("Plex");
    expect(screen.getByRole("button", { name: "Start Container" })).toBeTruthy();
  });

  it("renders updating state from persisted active operation after refresh", () => {
    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          status: "running",
          activeOperation: {
            id: "op-redeploy-1",
            action: "redeploy",
            status: "running",
            progressPercent: 45,
            currentStep: "compose-up",
            updatedAt: "2026-02-24T00:00:05.000Z",
          },
          webUiPort: 32400,
          containerName: "plex",
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    expect(
      screen.getByRole("button", { name: "Open Plex" }).getAttribute("data-app-status"),
    ).toBe("updating");
  });

  it("renders paused state for paused containers", () => {
    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          status: "paused",
          webUiPort: 32400,
          containerName: "plex",
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    expect(
      screen.getByRole("button", { name: "Open Plex" }).getAttribute("data-app-status"),
    ).toBe("paused");
  });

  it("shows a global action banner for active operations", () => {
    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          status: "running",
          activeOperation: {
            id: "op-redeploy-1",
            action: "redeploy",
            status: "running",
            progressPercent: 45,
            currentStep: "compose-up",
            updatedAt: "2026-02-24T00:00:05.000Z",
          },
          webUiPort: 32400,
          containerName: "plex",
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    expect(screen.getByRole("status").textContent).toContain("Redeploying Plex");
    expect(screen.getByText("45%")).toBeTruthy();
  });

  it("shows the app loading status screen while apps are loading", () => {
    useInstalledAppsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    useStoreCatalogMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    expect(screen.getByText("Syncing containers")).toBeTruthy();
  });

  it("renders no empty-state copy when no apps are installed", () => {
    useInstalledAppsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    useStoreCatalogMock.mockReturnValue({
      data: {
        apps: [],
      },
      isLoading: false,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    expect(screen.queryByText("No apps found.")).toBeNull();
    expect(
      screen.queryByText("Install an app from the App Store to see it here."),
    ).toBeNull();
  });

  it("opens uninstall dialog and triggers backend uninstall from remove action", async () => {
    const uninstallApp = vi.fn().mockResolvedValue(undefined);
    useStoreActionsMock.mockReturnValue({
      operationsByApp: {},
      uninstallApp,
    });

    render(<AppGrid animationsEnabled={false} />);

    expect(screen.getByRole("button", { name: "Open Plex" })).toBeTruthy();
    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Remove App" }));

    expect(
      screen.getByText((_, element) => element?.textContent === "Uninstall Plex?"),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Uninstall" }).at(-1)!);

    await waitFor(() => {
      expect(uninstallApp).toHaveBeenCalledWith({
        appId: "plex",
        removeVolumes: false,
      });
    });
  });

  it("keeps restart and update actions available after check-updates request", async () => {
    const checkAppUpdates = vi.fn().mockResolvedValue({
      appId: "plex",
      operationId: "op-1",
      action: "check-updates",
    });
    useStoreActionsMock.mockReturnValue({
      operationsByApp: {},
      uninstallApp: vi.fn().mockResolvedValue(undefined),
      checkAppUpdates,
      restartApp: vi.fn().mockResolvedValue({
        appId: "plex",
        operationId: "op-2",
        action: "restart",
      }),
      startApp: vi.fn(),
      stopApp: vi.fn(),
    });

    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Check Updates" }));
    await waitFor(() => {
      expect(checkAppUpdates).toHaveBeenCalledWith("plex");
    });

    openContextMenuFor("Plex");
    const restartButton = screen.getByRole("button", { name: "Restart Container" });
    const updatesButton = screen.getByRole("button", { name: "Check Updates" });
    expect((restartButton as HTMLButtonElement).disabled).toBe(false);
    expect((updatesButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("clears optimistic status and shows error when start/stop fails", async () => {
    const startApp = vi.fn().mockRejectedValue(new Error("Docker unavailable"));
    useStoreActionsMock.mockReturnValue({
      operationsByApp: {},
      uninstallApp: vi.fn().mockResolvedValue(undefined),
      startApp,
      stopApp: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      restartApp: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      checkAppUpdates: vi.fn().mockReturnValue(new Promise<never>(() => {})),
    });

    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "plex",
          name: "Plex",
          status: "stopped",
          webUiPort: 32400,
          containerName: "plex",
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Plex");
    fireEvent.click(screen.getByRole("button", { name: "Start Container" }));

    await waitFor(() => {
      expect(screen.getByText("Docker unavailable")).toBeTruthy();
    });

    // Status should be cleared back to original (stopped), not stuck as "running"
    expect(
      screen.getByRole("button", { name: "Open Plex" }).getAttribute("data-app-status"),
    ).toBe("stopped");
  });

  it("does not open the home page when dashboard url cannot be resolved", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    useInstalledAppsMock.mockReturnValue({
      data: [
        {
          id: "unknown-app",
          name: "Unknown App",
          status: "running",
          webUiPort: null,
          updatedAt: "2026-02-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });
    useStoreCatalogMock.mockReturnValue({
      data: {
        apps: [
          {
            id: "unknown-app",
            name: "Unknown App",
            description: "No known dashboard",
            platform: "linux",
            categories: ["Misc"],
            logoUrl: null,
            repositoryUrl: "https://example.com",
            stackFile: "Apps/unknown-app/docker-compose.yml",
            status: "installed",
            webUiPort: null,
            updateAvailable: false,
            localDigest: null,
            remoteDigest: null,
          },
        ],
      },
      isLoading: false,
      isError: false,
    });

    render(<AppGrid animationsEnabled={false} />);

    openContextMenuFor("Unknown App");
    const openButton = screen.getByRole("button", { name: "Open Dashboard" });
    expect((openButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(openButton);

    expect(openSpy).not.toHaveBeenCalled();
  });

});
