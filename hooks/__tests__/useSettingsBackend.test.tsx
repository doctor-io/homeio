/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { queryKeys } from "@/lib/shared/query-keys";
import { createTestQueryClient, createWrapper } from "@/test/query-client-wrapper";

const { toastSuccessMock, toastInfoMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

const mockUseCurrentUser = vi.fn();
const mockUseSystemMetrics = vi.fn();
const mockUseNetworkStatus = vi.fn();
const mockUseWifiNetworks = vi.fn();
const mockUseLocalFolderShares = vi.fn();
const mockUseNetworkShares = vi.fn();
const mockUseDockerStatsSnapshot = vi.fn();

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock("@/modules/system/hooks/useSystemMetrics", () => ({
  useSystemMetrics: () => mockUseSystemMetrics(),
}));

vi.mock("@/modules/system/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

vi.mock("@/modules/system/hooks/useWifiNetworks", () => ({
  useWifiNetworks: () => mockUseWifiNetworks(),
}));

vi.mock("@/modules/files/hooks/useLocalFolderShares", () => ({
  useLocalFolderShares: () => mockUseLocalFolderShares(),
}));

vi.mock("@/modules/files/hooks/useNetworkShares", () => ({
  useNetworkShares: () => mockUseNetworkShares(),
}));

vi.mock("@/modules/system/hooks/useDockerStats", () => ({
  useDockerStatsSnapshot: () => mockUseDockerStatsSnapshot(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    info: toastInfoMock,
    error: toastErrorMock,
  },
}));

import { useSettingsBackend } from "@/modules/settings/hooks/useSettingsBackend";

function mockOkJson<T>(data: T) {
  return { ok: true, json: async () => ({ data }) };
}

type FetchHandler = (
  url: string,
  init?: RequestInit,
) => ReturnType<typeof mockOkJson> | null | undefined;

function createFetchMock(actionHandler?: FetchHandler) {
  return vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    const override = actionHandler?.(url, init);
    if (override != null) return override;

    if (url === "/api/v1/system/preferences") {
      return mockOkJson({ hostname: "home-node", timezone: "Europe/Paris" });
    }
    if (url === "/api/v1/system/power/schedule") {
      return mockOkJson({ enabled: false, frequency: "weekly", dayOfWeek: "sunday", time: "03:00" });
    }
    if (url === "/api/v1/system/power/capabilities") {
      return mockOkJson({ reboot: true, shutdown: true, factoryReset: true, scheduledReboot: true });
    }
    if (url === "/api/v1/system/security") {
      return mockOkJson({
        firewallEnabled: true,
        firewallIncomingPolicy: "deny",
        firewallOutgoingPolicy: "allow",
        fail2banEnabled: true,
        fail2banMaxRetries: 5,
        fail2banBanDurationSeconds: 3600,
      });
    }
    if (url === "/api/v1/system/updates") {
      return mockOkJson({
        currentVersion: "0.1.74",
        latestVersion: "0.1.75",
        updateAvailable: true,
        checkedAt: "2026-03-08T10:00:00.000Z",
      });
    }
    if (url === "/api/v1/system/backups") {
      return mockOkJson({
        settings: { enabled: false, frequency: "weekly", dayOfWeek: "sunday", time: "03:00", retentionCount: 7 },
        backups: [],
        backupRoot: "/DATA/Backups/homeio",
      });
    }
    return { ok: true, json: async () => ({ data: [] }) };
  });
}

function setDefaultMocks() {
  mockUseCurrentUser.mockReturnValue({
    data: {
      id: "u1",
      username: "ahmed",
    },
    isLoading: false,
    error: null,
  });

  mockUseSystemMetrics.mockReturnValue({
    data: {
      timestamp: "2026-02-27T10:00:00.000Z",
      hostname: "home-node",
      platform: "linux",
      uptimeSeconds: 90061,
      cpu: {
        oneMinute: 0.3,
        fiveMinute: 0.2,
        fifteenMinute: 0.1,
        normalizedPercent: 32,
      },
      memory: {
        totalBytes: 8 * 1024 * 1024 * 1024,
        freeBytes: 3 * 1024 * 1024 * 1024,
        usedBytes: 5 * 1024 * 1024 * 1024,
        usedPercent: 62.5,
      },
      temperature: {
        mainCelsius: 47.2,
        maxCelsius: 49,
        coresCelsius: [46.5, 47.8],
      },
      battery: {
        hasBattery: false,
        isCharging: false,
        percent: null,
        timeRemainingMinutes: null,
        acConnected: null,
        manufacturer: null,
        cycleCount: null,
        designedCapacityWh: null,
        maxCapacityWh: null,
        designToMaxCapacityPercent: null,
      },
      wifi: {
        connected: true,
        iface: "wlan0",
        ssid: "HomeNet",
        bssid: "11:22:33:44",
        signalPercent: 78,
        txRateMbps: 150,
        downloadMbps: 30,
        uploadMbps: 10,
        ipv4: "192.168.1.20",
        ipv6: null,
        availableNetworks: [],
      },
      process: {
        pid: 123,
        uptimeSeconds: 7200,
        nodeVersion: "v22.17.0",
      },
      storage: {
        mountPath: "/DATA",
        totalBytes: 4 * 1024 * 1024 * 1024 * 1024,
        availableBytes: 2200 * 1024 * 1024 * 1024,
        usedBytes: 1800 * 1024 * 1024 * 1024,
        usedPercent: 45,
      },
    },
    isLoading: false,
    error: null,
  });

  mockUseNetworkStatus.mockReturnValue({
    data: {
      connected: true,
      iface: "wlan0",
      ssid: "HomeNet",
      ipv4: "192.168.1.20",
      signalPercent: 78,
    },
    isLoading: false,
    error: null,
  });

  mockUseWifiNetworks.mockReturnValue({
    data: [
      {
        ssid: "HomeNet",
        bssid: "11:22:33:44",
        signalPercent: 80,
        channel: 6,
        frequencyMhz: 2437,
        security: "wpa2",
      },
      {
        ssid: "GuestNet",
        bssid: "aa:bb:cc:dd",
        signalPercent: 42,
        channel: 11,
        frequencyMhz: 2462,
        security: "wpa2",
      },
    ],
    isLoading: false,
    error: null,
  });

  mockUseDockerStatsSnapshot.mockReturnValue({
    stats: [
      {
        id: "container123456789",
        name: "plex",
        state: "running",
        cpuPercent: 3.4,
        memoryUsed: 512 * 1024 * 1024,
        memoryLimit: 2 * 1024 * 1024 * 1024,
        memoryPercent: 25,
        networkRx: 10,
        networkTx: 15,
        blockRead: 1,
        blockWrite: 2,
      },
    ],
    isLoading: false,
    error: null,
  });

  mockUseLocalFolderShares.mockReturnValue({
    data: [
      {
        id: "local-1",
        shareName: "Media",
        sourcePath: "Media",
        sharedPath: "Shared/Media",
        isMounted: true,
        isExported: true,
      },
    ],
    isLoading: false,
    error: null,
  });

  mockUseNetworkShares.mockReturnValue({
    data: [
      {
        id: "network-1",
        host: "nas.local",
        share: "Public",
        username: "guest",
        mountPath: "Network/nas.local/Public",
        isMounted: true,
      },
    ],
    isLoading: false,
    error: null,
  });

}

describe("useSettingsBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setDefaultMocks();
    vi.stubGlobal(
      "fetch",
      createFetchMock((url) => {
        if (url === "/api/v1/system/backups") {
          return mockOkJson({
            settings: { enabled: false, frequency: "weekly", dayOfWeek: "sunday", time: "03:00", retentionCount: 7 },
            backups: [
              {
                id: "backup-1",
                createdAt: "2026-03-08T09:00:00.000Z",
                sizeBytes: 1024,
                appVersion: "0.1.72",
                hostname: "home-node",
                backupPath: "/DATA/Backups/homeio/backup-1.tar.gz",
                dbDumpIncluded: true,
                dataRootIncluded: true,
                stacksRootIncluded: true,
                status: "completed",
              },
            ],
            backupRoot: "/DATA/Backups/homeio",
          });
        }
        return null;
      }),
    );
  });

  it("maps live settings data and capability flags", async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    expect(result.current.general.hostname).toBe("home-node");
    expect(result.current.general.uptime).toContain("1 day");
    expect(result.current.network.iface).toBe("wlan0");
    expect(result.current.network.topSsids).toEqual(["HomeNet", "GuestNet"]);
    expect(result.current.storage.mountPath).toBe("/DATA");
    expect(result.current.storage.shares).toHaveLength(2);
    expect(result.current.docker.containers).toHaveLength(1);
    expect(result.current.power.reboot.isPending).toBe(false);
    await waitFor(() => {
      expect(result.current.power.reboot.available).toBe(true);
      expect(result.current.power.shutdown.available).toBe(true);
      expect(result.current.power.factoryReset.available).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.generalPreferences.timezone).toBe("Europe/Paris");
    });
    expect(result.current.generalPreferences.hostname).toBe("home-node");
    await waitFor(() => {
      expect(result.current.security.firewall.enabled).toBe(true);
    });
    expect(result.current.security.fail2ban.maxRetries).toBe(5);
    expect(result.current.backup.backups).toHaveLength(1);
    expect(result.current.backup.backupRoot).toBe("/DATA/Backups/homeio");
    expect(result.current.power.scheduledReboot.time).toBe("03:00");
    expect(result.current.capabilities.general.hostname.disabled).toBe(false);
    await waitFor(() => {
      expect(result.current.updates.currentVersion).toBe("0.1.74");
      expect(result.current.updates.latestVersion).toBe("0.1.75");
      expect(result.current.updates.updateAvailable).toBe(true);
    });
    expect(result.current.capabilities.updates.checkForUpdates.disabled).toBe(false);
    expect(result.current.capabilities.saveBySection.security).toBe(true);
  });

  it("marks sections unavailable when source hooks fail", () => {
    mockUseSystemMetrics.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("metrics down"),
    });

    mockUseNetworkStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("network down"),
    });

    mockUseDockerStatsSnapshot.mockReturnValue({
      stats: [],
      isLoading: false,
      error: "docker down",
    });

    const client = createTestQueryClient();
    vi.stubGlobal(
      "fetch",
      createFetchMock((url) => {
        if (url === "/api/v1/system/updates") {
          return { ok: false, json: async () => ({ error: "updates down" }) };
        }
        return null;
      }),
    );
    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    expect(result.current.general.unavailable).toBe(true);
    expect(result.current.network.unavailable).toBe(true);
    expect(result.current.docker.unavailable).toBe(true);
    return waitFor(() => {
      expect(result.current.updates.unavailable).toBe(true);
    });
  });

  it("triggers Homeio update check mutation and invalidates system updates", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/updates/check" && init?.method === "POST") {
        return mockOkJson({ currentVersion: "0.1.74", latestVersion: "0.1.75", updateAvailable: true, checkedAt: "2026-03-08T10:00:00.000Z" });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.actions.checkForUpdates();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/system/updates/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemUpdates,
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Homeio 0.1.75 is available.");
  });

  it("persists update recovery state and redirects to the dedicated updating screen", async () => {
    const client = createTestQueryClient();
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/updates") {
        return mockOkJson({ currentVersion: "0.1.79", latestVersion: "0.1.80", updateAvailable: true, checkedAt: "2026-03-11T10:00:00.000Z" });
      }
      if (url === "/api/v1/system/updates/apply?version=0.1.80" && init?.method === "POST") {
        return mockOkJson({ action: "update", accepted: true });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.updates.latestVersion).toBe("0.1.80"));
    await act(async () => {
      await expect(result.current.actions.applySystemUpdate()).resolves.toBeUndefined();
    });

    expect(
      JSON.parse(localStorage.getItem("system.power.action.v1") ?? "{}"),
    ).toMatchObject({
      action: "update",
      requestDispatchedAt: expect.any(String),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/system/updates/apply?version=0.1.80",
      {
        method: "POST",
      },
    );
  });

  it("keeps update recovery active after redirecting to the dedicated updating screen", async () => {
    const client = createTestQueryClient();
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/updates") {
        return mockOkJson({ currentVersion: "0.1.81", latestVersion: "0.1.82", updateAvailable: true, checkedAt: "2026-03-11T21:49:04.000Z" });
      }
      if (url === "/api/v1/system/updates/apply?version=0.1.82" && init?.method === "POST") {
        return mockOkJson({ action: "update", accepted: true });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.updates.latestVersion).toBe("0.1.82"));
    await act(async () => {
      await expect(result.current.actions.applySystemUpdate()).resolves.toBeUndefined();
    });

    expect(
      JSON.parse(localStorage.getItem("system.power.action.v1") ?? "{}"),
    ).toMatchObject({
      action: "update",
    });
    expect(result.current.updates.isRecoveryActive).toBe(true);
  });

  it("surfaces update scheduling failures without entering recovery", async () => {
    const client = createTestQueryClient();
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/updates") {
        return mockOkJson({ currentVersion: "0.1.81", latestVersion: "0.1.82", updateAvailable: true, checkedAt: "2026-03-11T21:49:04.000Z" });
      }
      if (url === "/api/v1/system/updates/apply?version=0.1.82" && init?.method === "POST") {
        return { ok: false, status: 500, json: async () => ({ error: "Update runner failed" }) };
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.updates.latestVersion).toBe("0.1.82"));
    await act(async () => {
      await expect(result.current.actions.applySystemUpdate()).resolves.toBeUndefined();
    });

    expect(localStorage.getItem("system.power.action.v1")).toBeNull();
    await waitFor(() => {
      expect(result.current.updates.isRecoveryActive).toBe(false);
      expect(result.current.updates.applyError).toBe("Update runner failed");
    });
  });

  it("suppresses Homeio update fetches while update recovery is active", async () => {
    localStorage.setItem(
      "system.power.action.v1",
      JSON.stringify({
        action: "update",
        startedAt: new Date().toISOString(),
      }),
    );

    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.updates.isRecoveryActive).toBe(true);
    });

    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/system/updates", expect.anything());
    expect(result.current.updates.unavailable).toBe(false);
    expect(result.current.updates.checkError).toBeNull();
  });

  it("triggers reboot mutation and persists reboot recovery state", async () => {
    const client = createTestQueryClient();
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/power/reboot" && init?.method === "POST") {
        return mockOkJson({ action: "reboot", accepted: true });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.actions.rebootNow();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/system/power/reboot", {
      method: "POST",
    });
    expect(
      JSON.parse(localStorage.getItem("system.power.action.v1") ?? "{}"),
    ).toMatchObject({
      action: "reboot",
    });
  });

  it("saves scheduled reboot configuration", async () => {
    const client = createTestQueryClient();
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/power/schedule" && init?.method === "PUT") {
        return mockOkJson(JSON.parse(String(init.body)));
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.actions.saveScheduledReboot({
        enabled: true,
        frequency: "daily",
        dayOfWeek: "sunday",
        time: "04:00",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/system/power/schedule", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        frequency: "daily",
        dayOfWeek: "sunday",
        time: "04:00",
      }),
    });
  });

  it("saves general preferences and invalidates system queries", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/preferences" && init?.method === "PUT") {
        return mockOkJson({ hostname: "homeio-box", timezone: "Europe/Berlin" });
      }
      if (url === "/api/v1/system/security" && init?.method === "PUT") {
        return mockOkJson(JSON.parse(String(init.body)));
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.actions.saveGeneralPreferences({
        hostname: "homeio-box",
        timezone: "Europe/Berlin",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/system/preferences", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hostname: "homeio-box",
        timezone: "Europe/Berlin",
      }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemPreferences,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemMetrics,
    });
  });

  it("saves security settings and invalidates the security query", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/security" && init?.method === "PUT") {
        return mockOkJson(JSON.parse(String(init.body)));
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.actions.saveSecuritySettings({
        firewallEnabled: false,
        firewallIncomingPolicy: "reject",
        firewallOutgoingPolicy: "deny",
        fail2banEnabled: false,
        fail2banMaxRetries: 7,
        fail2banBanDurationSeconds: 7200,
      });
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/system/security", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        firewallEnabled: false,
        firewallIncomingPolicy: "reject",
        firewallOutgoingPolicy: "deny",
        fail2banEnabled: false,
        fail2banMaxRetries: 7,
        fail2banBanDurationSeconds: 7200,
      }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemSecurity,
    });
  });

  it("prunes docker images and volumes and invalidates docker queries", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/docker/prune/images" && init?.method === "POST") {
        return mockOkJson({ command: "images", output: "Deleted Images:\nsha256:deadbeef" });
      }
      if (url === "/api/v1/docker/prune/volumes" && init?.method === "POST") {
        return mockOkJson({ command: "volumes", output: "Deleted Volumes:\nold-volume" });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.actions.pruneDockerImages();
      await result.current.actions.pruneDockerVolumes();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docker/prune/images", {
      method: "POST",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docker/prune/volumes", {
      method: "POST",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.dockerInfo,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemMetrics,
    });
  });

  it("saves backup settings and invalidates backup queries", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/backups/settings" && init?.method === "PUT") {
        return mockOkJson(JSON.parse(String(init.body)));
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.actions.saveBackupSettings({
        enabled: true,
        frequency: "daily",
        dayOfWeek: "monday",
        time: "02:30",
        retentionCount: 14,
      });
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/system/backups/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        frequency: "daily",
        dayOfWeek: "monday",
        time: "02:30",
        retentionCount: 14,
      }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemBackups,
    });
  });

  it("persists restore recovery state when a backup restore starts", async () => {
    const client = createTestQueryClient();
    const fetchMock = createFetchMock((url, init) => {
      if (url === "/api/v1/system/backups/backup-1/restore" && init?.method === "POST") {
        return mockOkJson({ action: "restore", accepted: true, backupId: "backup-1" });
      }
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsBackend(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.actions.restoreBackup("backup-1");
    });

    expect(
      JSON.parse(localStorage.getItem("system.power.action.v1") ?? "{}"),
    ).toMatchObject({
      action: "restore",
    });
  });
});
