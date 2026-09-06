/* @vitest-environment jsdom */

import {
  fireEvent,
  render as renderComponent,
  screen,
  type RenderOptions,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppearanceSettings } from "@/lib/desktop/appearance";

const mockUseSettingsBackend = vi.fn();
const mockUseDesktopPreferences = vi.fn();

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/modules/settings/hooks/useSettingsBackend", () => ({
  useSettingsBackend: () => mockUseSettingsBackend(),
}));

vi.mock("@/hooks/useDesktopPreferences", () => ({
  useDesktopPreferences: () => mockUseDesktopPreferences(),
}));

const inertMutation = () => ({
  mutateAsync: vi.fn(),
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  error: null,
  data: undefined,
});

vi.mock("@/modules/settings/hooks/useTwoFactor", () => ({
  TwoFactorApiError: class TwoFactorApiError extends Error {},
  useStartTwoFactorSetup: () => inertMutation(),
  useVerifyTwoFactor: () => inertMutation(),
  useDisableTwoFactor: () => inertMutation(),
}));

import { SettingsPanel } from "@/modules/settings/components/settings";
import {
  createTestQueryClient,
  createWrapper,
} from "@/test/query-client-wrapper";

// The panel reads the licence plan through react-query, so every render needs
// a client — the real app supplies one from app-providers.
function render(ui: ReactElement, options?: RenderOptions) {
  return renderComponent(ui, {
    wrapper: createWrapper(createTestQueryClient()),
    ...options,
  });
}

const appearance: AppearanceSettings = {
  theme: "dark",
  wallpaper: "wallpaper-1.jpg",
  accentColor: "oklch(0.72 0.14 190)",
  radius: 14,
  glassStyle: "clear",
  iconSize: "medium",
  dockPosition: "bottom",
  fontSize: "default",
  animationsEnabled: true,
};

function createBackendMock() {
  return {
    general: {
      hostname: "home-node",
      platform: "linux",
      kernel: "v22.17.0",
      architecture: "--",
      uptime: "1 day, 2 hours",
      appVersion: "--",
      username: "ahmed",
      cpuSummary: "30% load",
      memorySummary: "2.0 GB / 8.0 GB",
      temperatureSummary: "44.5 C",
      processUptime: "2 hours",
      twoFactor: { enabled: false, enrolledAt: null },
      isDemoMode: false,
      isLoading: false,
      unavailable: false,
      warning: null,
    },
    network: {
      connected: true,
      iface: "wlan0",
      ipv4: "192.168.1.20",
      ssid: "HomeNet",
      signalPercent: "78%",
      wifiCount: 2,
      topSsids: ["HomeNet", "GuestNet"],
      isLoading: false,
      unavailable: false,
      warning: null,
    },
    storage: {
      mountPath: "/DATA",
      totalBytes: 4 * 1024 * 1024 * 1024 * 1024,
      usedBytes: 1800 * 1024 * 1024 * 1024,
      availableBytes: 2200 * 1024 * 1024 * 1024,
      usedPercent: 45,
      summary: "1800.00 GB / 4096.00 GB",
      shares: [
        {
          id: "local-1",
          name: "Media",
          path: "/Shared/Media",
          source: "/Media",
          protocol: "SMB usershare",
          status: "Mounted",
        },
      ],
      localShareCount: 1,
      networkShareCount: 0,
      isLoading: false,
      unavailable: false,
      warning: null,
    },
    docker: {
      containers: [],
      total: 1,
      running: 1,
      images: "--",
      engineVersion: "--",
      composeVersion: "--",
      storageDriver: "--",
      cgroupDriver: "--",
      isLoading: false,
      unavailable: false,
      warning: null,
      pruneImages: {
        isPending: false,
        error: null,
      },
      pruneVolumes: {
        isPending: false,
        error: null,
      },
    },
    security: {
      firewall: {
        enabled: true,
        incomingPolicy: "deny" as const,
        outgoingPolicy: "allow" as const,
        policyOptions: ["allow", "deny", "reject"] as const,
      },
      fail2ban: {
        enabled: true,
        maxRetries: 5,
        banDuration: 3600,
        maxRetriesBounds: {
          min: 1,
          max: 20,
        },
        banDurationBounds: {
          min: 60,
          max: 2592000,
        },
      },
      isLoading: false,
      isSaving: false,
      unavailable: false,
      error: null,
    },
    backup: {
      settings: {
        enabled: false,
        frequency: "weekly" as const,
        dayOfWeek: "sunday" as const,
        time: "03:00",
        retentionCount: 7,
        isLoading: false,
        isSaving: false,
        error: null,
      },
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
          status: "completed" as const,
        },
      ],
      backupRoot: "/DATA/Backups/homeio",
      isLoading: false,
      runNow: {
        isPending: false,
        error: null,
      },
      restore: {
        isPending: false,
        error: null,
      },
    },
    updates: {
      currentVersion: "0.1.74",
      latestVersion: "0.1.75",
      updateAvailable: true,
      checkedAt: "2026-03-08T10:00:00.000Z",
      isLoading: false,
      unavailable: false,
      warning: null,
      isChecking: false,
      isApplying: false,
      checkError: null,
      applyError: null,
    },
    power: {
      reboot: {
        available: true,
        isPending: false,
        error: null,
      },
      shutdown: {
        available: true,
        isPending: false,
        error: null,
      },
      factoryReset: {
        available: true,
        isPending: false,
        error: null,
      },
      scheduledReboot: {
        available: true,
        enabled: false,
        frequency: "weekly" as const,
        dayOfWeek: "sunday" as const,
        time: "03:00",
        isLoading: false,
        isPending: false,
        error: null,
      },
    },
    generalPreferences: {
      hostname: "home-node",
      timezone: "Europe/Paris",
      timezoneOptions: ["UTC", "Europe/Paris", "Europe/Berlin"],
      isLoading: false,
      isSaving: false,
      error: null,
    },
    capabilities: {
      general: {
        hostname: { disabled: false, disabledReason: undefined },
        timezone: { disabled: false, disabledReason: undefined },
        language: { disabled: false, disabledReason: undefined },
      },
      network: {
        gateway: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        dnsPrimary: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        dnsSecondary: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        domain: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        dhcp: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        ipv6: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        wol: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        mtu: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        addRule: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
      },
      docker: {
        lifecycle: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        autoRestart: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        logRotation: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        defaultNetwork: { disabled: true, disabledReason: "Not available yet: backend endpoint not implemented" },
        pruneImages: { disabled: false, disabledReason: undefined },
        pruneVolumes: { disabled: false, disabledReason: undefined },
      },
      security: {
        firewall: { disabled: false, disabledReason: undefined },
        fail2ban: { disabled: false, disabledReason: undefined },
      },
      backup: {
        schedule: { disabled: false, disabledReason: undefined },
        runNow: { disabled: false, disabledReason: undefined },
        restore: { disabled: false, disabledReason: undefined },
      },
      updates: {
        updateHomeio: { disabled: false, disabledReason: undefined },
        autoCheck: { disabled: false, disabledReason: undefined },
        checkForUpdates: { disabled: false, disabledReason: undefined },
      },
      unsupportedSectionReason: "Not available yet: backend endpoint not implemented",
      saveBySection: {
        general: true,
        network: false,
        storage: false,
        docker: false,
        users: false,
        security: true,
        notifications: true,
        backup: true,
        updates: false,
        power: true,
      },
      saveDisabledReason: "Not available in this pass: no save endpoint",
    },
    actions: {
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      applySystemUpdate: vi.fn().mockResolvedValue(undefined),
      saveGeneralPreferences: vi.fn().mockResolvedValue(undefined),
      saveSecuritySettings: vi.fn().mockResolvedValue(undefined),
      saveBackupSettings: vi.fn().mockResolvedValue(undefined),
      runBackupNow: vi.fn().mockResolvedValue(undefined),
      restoreBackup: vi.fn().mockResolvedValue(undefined),
      rebootNow: vi.fn().mockResolvedValue(undefined),
      shutdownNow: vi.fn().mockResolvedValue(undefined),
      saveScheduledReboot: vi.fn().mockResolvedValue(undefined),
      pruneDockerImages: vi.fn().mockResolvedValue(undefined),
      pruneDockerVolumes: vi.fn().mockResolvedValue(undefined),
      factoryReset: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    mockUseSettingsBackend.mockReturnValue(createBackendMock());
    mockUseDesktopPreferences.mockReturnValue({
      preferences: {
        language: "en-US",
        autoCheckUpdates: true,
        notifications: {
          systemAlertsEnabled: true,
          updateNotificationsEnabled: true,
          backupReportsEnabled: true,
          securityEventsEnabled: false,
          cpuAlertThresholdPercent: 85,
          memoryAlertThresholdPercent: 85,
          diskAlertThresholdPercent: 90,
          temperatureAlertThresholdCelsius: 80,
        },
      },
      isHydrated: true,
      languageLabel: "English (US)",
      languageOptions: [
        { code: "en-US", label: "English (US)" },
        { code: "fr-FR", label: "Francais" },
      ],
      setLanguage: vi.fn(),
      setAutoCheckUpdates: vi.fn(),
      notificationPreferences: {
        systemAlertsEnabled: true,
        updateNotificationsEnabled: true,
        backupReportsEnabled: true,
        securityEventsEnabled: false,
        cpuAlertThresholdPercent: 85,
        memoryAlertThresholdPercent: 85,
        diskAlertThresholdPercent: 90,
        temperatureAlertThresholdCelsius: 80,
      },
      setSystemAlertsEnabled: vi.fn(),
      setUpdateNotificationsEnabled: vi.fn(),
      setBackupReportsEnabled: vi.fn(),
      setSecurityEventsEnabled: vi.fn(),
      setCpuAlertThresholdPercent: vi.fn(),
      setMemoryAlertThresholdPercent: vi.fn(),
      setDiskAlertThresholdPercent: vi.fn(),
      setTemperatureAlertThresholdCelsius: vi.fn(),
      setNotificationPreferences: vi.fn(),
    });
  });

  it("renders General with backend hostname and uptime", () => {
    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    expect(screen.getAllByText("home-node").length).toBeGreaterThan(0);
    expect(screen.getByText("1 day, 2 hours")).toBeTruthy();
    expect(screen.queryByText("Auto-start services on boot")).toBeNull();
  });

  it("renders Network disconnected state", () => {
    const backend = createBackendMock();
    backend.network.connected = false;
    backend.network.signalPercent = "--";
    backend.network.ssid = "--";
    mockUseSettingsBackend.mockReturnValue(backend);

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Network/i }));

    expect(screen.getByText("Disconnected")).toBeTruthy();
    expect(screen.getByText("Signal --")).toBeTruthy();
  });

  it("shows only Docker engine status and maintenance actions", () => {
    const backend = createBackendMock();
    mockUseSettingsBackend.mockReturnValue(backend);

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Docker/i }));

    expect(screen.getByText("Engine")).toBeTruthy();
    expect(screen.getByText("Maintenance")).toBeTruthy();
    expect(screen.queryByText("No containers reported.")).toBeNull();
    expect(screen.queryByText("Auto-restart policy")).toBeNull();
    expect(screen.queryByText("Log rotation")).toBeNull();
    expect(screen.queryByText("Default Network")).toBeNull();

    const runButtons = screen.getAllByRole("button", { name: "Run" });
    fireEvent.click(runButtons[0]!);
    fireEvent.click(runButtons[1]!);

    expect(backend.actions.pruneDockerImages).toHaveBeenCalledTimes(1);
    expect(backend.actions.pruneDockerVolumes).toHaveBeenCalledTimes(1);
  });

  it("triggers Homeio update actions", () => {
    const backend = createBackendMock();
    const setAutoCheckUpdates = vi.fn();
    mockUseSettingsBackend.mockReturnValue(backend);
    mockUseDesktopPreferences.mockReturnValue({
      preferences: {
        language: "en-US",
        autoCheckUpdates: true,
        notifications: {
          systemAlertsEnabled: true,
          updateNotificationsEnabled: true,
          backupReportsEnabled: true,
          securityEventsEnabled: false,
          cpuAlertThresholdPercent: 85,
          memoryAlertThresholdPercent: 85,
          diskAlertThresholdPercent: 90,
          temperatureAlertThresholdCelsius: 80,
        },
      },
      isHydrated: true,
      languageLabel: "English (US)",
      languageOptions: [
        { code: "en-US", label: "English (US)" },
        { code: "fr-FR", label: "Francais" },
      ],
      setLanguage: vi.fn(),
      setAutoCheckUpdates,
      notificationPreferences: {
        systemAlertsEnabled: true,
        updateNotificationsEnabled: true,
        backupReportsEnabled: true,
        securityEventsEnabled: false,
        cpuAlertThresholdPercent: 85,
        memoryAlertThresholdPercent: 85,
        diskAlertThresholdPercent: 90,
        temperatureAlertThresholdCelsius: 80,
      },
      setSystemAlertsEnabled: vi.fn(),
      setUpdateNotificationsEnabled: vi.fn(),
      setBackupReportsEnabled: vi.fn(),
      setSecurityEventsEnabled: vi.fn(),
      setCpuAlertThresholdPercent: vi.fn(),
      setMemoryAlertThresholdPercent: vi.fn(),
      setDiskAlertThresholdPercent: vi.fn(),
      setTemperatureAlertThresholdCelsius: vi.fn(),
      setNotificationPreferences: vi.fn(),
    });

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Updates/i }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(backend.actions.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(backend.actions.applySystemUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Homeio")).toBeTruthy();
    expect(screen.getByText("0.1.74")).toBeTruthy();
    expect(screen.getByText("0.1.75")).toBeTruthy();
    expect(screen.getByText("v0.1.75 available")).toBeTruthy();
    expect(screen.queryByText("Update channel")).toBeNull();
    expect(screen.queryByText("Auto-update policy")).toBeNull();
    expect(screen.queryByText("Update History")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Toggle Auto-check for updates" }));
    expect(setAutoCheckUpdates).toHaveBeenCalledWith(false);
  });

  it("renders real backup controls and removes placeholder backup fields", () => {
    const backend = createBackendMock();
    mockUseSettingsBackend.mockReturnValue(backend);

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Backup & Restore/i }));

    expect(screen.getByText("Schedule")).toBeTruthy();
    expect(screen.getByText("/DATA/Backups/homeio")).toBeTruthy();
    expect(screen.queryByText("Backup Target")).toBeNull();
    expect(screen.queryByText("Encryption")).toBeNull();
    expect(screen.queryByText("What to Back Up")).toBeNull();
    expect(screen.queryByText("Destination")).toBeNull();
  });

  it("saves backup settings, runs backups, and restores selected backups", () => {
    const backend = createBackendMock();
    mockUseSettingsBackend.mockReturnValue(backend);

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Backup & Restore/i }));
    fireEvent.change(screen.getByDisplayValue("7"), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(backend.actions.saveBackupSettings).toHaveBeenCalledWith({
      enabled: false,
      frequency: "weekly",
      dayOfWeek: "sunday",
      time: "03:00",
      retentionCount: 14,
    });

    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(backend.actions.runBackupNow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore Backup" }));
    expect(backend.actions.restoreBackup).toHaveBeenCalledWith("backup-1");
  });

  it("renders users section in single-user mode", () => {
    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Users & Access/i }));

    expect(
      screen.getByText(
        "Homeio is currently single-user. Multi-user access is planned for a future release.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("ahmed")).toBeTruthy();
    expect(screen.queryByText("sarah")).toBeNull();
    expect(screen.queryByText("media-user")).toBeNull();
    expect(screen.queryByText("backup-bot")).toBeNull();
    // The banner above states the single-user limit; a disabled "Add User"
    // button said it a third time as a control nobody could use.
    expect(screen.queryByRole("button", { name: /Add User/i })).toBeNull();
    expect(screen.queryByText("Soon")).toBeNull();
  });

  it("renders only real security controls and saves security settings", () => {
    const backend = createBackendMock();
    mockUseSettingsBackend.mockReturnValue(backend);

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Security$/i }));

    expect(screen.getByText("Firewall")).toBeTruthy();
    expect(screen.getByText("Intrusion Prevention")).toBeTruthy();
    expect(screen.queryByText("SSL / TLS")).toBeNull();
    expect(screen.queryByText("VPN")).toBeNull();
    expect(screen.queryByText("Audit & Logging")).toBeNull();
    expect(screen.queryByText("Security auto-updates")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("5"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(backend.actions.saveSecuritySettings).toHaveBeenCalledWith({
      firewallEnabled: true,
      firewallIncomingPolicy: "deny",
      firewallOutgoingPolicy: "allow",
      fail2banEnabled: true,
      fail2banMaxRetries: 7,
      fail2banBanDurationSeconds: 3600,
    });
  });

  it("wires power actions and scheduled reboot save", async () => {
    const backend = createBackendMock();
    mockUseSettingsBackend.mockReturnValue(backend);

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Power$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Reboot/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reboot now" }));

    expect(backend.actions.rebootNow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^Shutdown/ }));
    fireEvent.click(screen.getByRole("button", { name: "Shutdown now" }));
    expect(backend.actions.shutdownNow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle Scheduled reboot" }));
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(backend.actions.saveScheduledReboot).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Factory Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Factory reset" }));
    expect(backend.actions.factoryReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Shutdown")).toBeTruthy();
    expect(screen.queryByText("Sleep")).toBeNull();
    expect(screen.queryByText("UPS monitoring unavailable")).toBeNull();
    expect(screen.queryByText("Uptime alerts")).toBeNull();
  });

  it("saves general preferences and persists language locally", async () => {
    const backend = createBackendMock();
    const setLanguage = vi.fn();
    mockUseSettingsBackend.mockReturnValue(backend);
    mockUseDesktopPreferences.mockReturnValue({
      preferences: {
        language: "en-US",
        autoCheckUpdates: true,
        notifications: {
          systemAlertsEnabled: true,
          updateNotificationsEnabled: true,
          backupReportsEnabled: true,
          securityEventsEnabled: false,
          cpuAlertThresholdPercent: 85,
          memoryAlertThresholdPercent: 85,
          diskAlertThresholdPercent: 90,
          temperatureAlertThresholdCelsius: 80,
        },
      },
      isHydrated: true,
      languageLabel: "English (US)",
      languageOptions: [
        { code: "en-US", label: "English (US)" },
        { code: "fr-FR", label: "Francais" },
      ],
      setLanguage,
      setAutoCheckUpdates: vi.fn(),
      notificationPreferences: {
        systemAlertsEnabled: true,
        updateNotificationsEnabled: true,
        backupReportsEnabled: true,
        securityEventsEnabled: false,
        cpuAlertThresholdPercent: 85,
        memoryAlertThresholdPercent: 85,
        diskAlertThresholdPercent: 90,
        temperatureAlertThresholdCelsius: 80,
      },
      setSystemAlertsEnabled: vi.fn(),
      setUpdateNotificationsEnabled: vi.fn(),
      setBackupReportsEnabled: vi.fn(),
      setSecurityEventsEnabled: vi.fn(),
      setCpuAlertThresholdPercent: vi.fn(),
      setMemoryAlertThresholdPercent: vi.fn(),
      setDiskAlertThresholdPercent: vi.fn(),
      setTemperatureAlertThresholdCelsius: vi.fn(),
      setNotificationPreferences: vi.fn(),
    });

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("home-node"), {
      target: { value: "homeio-box" },
    });
    fireEvent.change(screen.getByDisplayValue("English (US)"), {
      target: { value: "Francais" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(setLanguage).toHaveBeenCalledWith("fr-FR");
    expect(backend.actions.saveGeneralPreferences).toHaveBeenCalledWith({
      hostname: "homeio-box",
      timezone: "Europe/Paris",
    });
    expect(screen.queryByText("Remote access")).toBeNull();
    expect(screen.queryByText("Anonymous telemetry")).toBeNull();
  });

  it("saves notifications to local desktop preferences", () => {
    const backend = createBackendMock();
    const setNotificationPreferences = vi.fn();
    mockUseSettingsBackend.mockReturnValue(backend);
    mockUseDesktopPreferences.mockReturnValue({
      preferences: {
        language: "en-US",
        autoCheckUpdates: true,
        notifications: {
          systemAlertsEnabled: true,
          updateNotificationsEnabled: true,
          backupReportsEnabled: true,
          securityEventsEnabled: false,
          cpuAlertThresholdPercent: 85,
          memoryAlertThresholdPercent: 85,
          diskAlertThresholdPercent: 90,
          temperatureAlertThresholdCelsius: 80,
        },
      },
      isHydrated: true,
      languageLabel: "English (US)",
      languageOptions: [
        { code: "en-US", label: "English (US)" },
        { code: "fr-FR", label: "Francais" },
      ],
      setLanguage: vi.fn(),
      setAutoCheckUpdates: vi.fn(),
      notificationPreferences: {
        systemAlertsEnabled: true,
        updateNotificationsEnabled: true,
        backupReportsEnabled: true,
        securityEventsEnabled: false,
        cpuAlertThresholdPercent: 85,
        memoryAlertThresholdPercent: 85,
        diskAlertThresholdPercent: 90,
        temperatureAlertThresholdCelsius: 80,
      },
      setSystemAlertsEnabled: vi.fn(),
      setUpdateNotificationsEnabled: vi.fn(),
      setBackupReportsEnabled: vi.fn(),
      setSecurityEventsEnabled: vi.fn(),
      setCpuAlertThresholdPercent: vi.fn(),
      setMemoryAlertThresholdPercent: vi.fn(),
      setDiskAlertThresholdPercent: vi.fn(),
      setTemperatureAlertThresholdCelsius: vi.fn(),
      setNotificationPreferences,
    });

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Notifications/i }));
    expect(screen.queryByText("Not available yet: backend endpoint not implemented")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle Update notifications" }));
    fireEvent.change(screen.getByDisplayValue("90"), {
      target: { value: "92" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(setNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it("renders wallpapers in a horizontal responsive scroller", () => {
    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[
          { id: "wallpaper-1", name: "Wallpaper 1", src: "/images/one.jpg" },
          { id: "wallpaper-2", name: "Wallpaper 2", src: "/images/two.jpg" },
          { id: "wallpaper-3", name: "Wallpaper 3", src: "/images/three.jpg" },
        ]}
        accentOptions={[]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Appearance$/i }));

    const scroller = screen.getByTestId("wallpaper-scroller");
    expect(scroller.className).toContain("flex");
    expect(scroller.className).toContain("overflow-x-auto");

    const wallpaperButton = screen.getByTitle("Wallpaper 1");
    expect(wallpaperButton.className).toContain("shrink-0");
  });

  it("renders theme and accent color pickers as horizontal scrollers", () => {
    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[
          { name: "Teal", value: "oklch(0.72 0.14 190)" },
          { name: "Blue", value: "oklch(0.65 0.2 250)" },
        ]}
        onAppearanceChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Appearance$/i }));

    const themeScroller = screen.getByTestId("theme-scroller");
    expect(themeScroller.className).toContain("flex");
    expect(themeScroller.className).toContain("overflow-x-auto");

    const accentScroller = screen.getByTestId("accent-scroller");
    expect(accentScroller.className).toContain("flex");
    expect(accentScroller.className).toContain("overflow-x-auto");

    expect(screen.getByTitle("Dark").className).toContain("shrink-0");
    expect(screen.getByTitle("Teal").className).toContain("shrink-0");
  });

  it("lets the user switch corner radius presets in appearance", () => {
    const onAppearanceChange = vi.fn();

    render(
      <SettingsPanel
        appearance={appearance}
        wallpaperOptions={[]}
        accentOptions={[]}
        onAppearanceChange={onAppearanceChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Appearance$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Set Soft radius" }));

    expect(onAppearanceChange).toHaveBeenCalledWith({ radius: 20 });
    expect(screen.getByText("14px")).toBeTruthy();
  });
});
