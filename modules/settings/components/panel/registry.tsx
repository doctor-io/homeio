import {
  Bell         as AlertRegular,
  RefreshCw    as ArrowSyncRegular,
  Container    as BoxRegular,
  CalendarClock as CalendarClockRegular,
  Database     as DatabaseRegular,
  HardDrive    as HardDriveRegular,
  Paintbrush   as PaintBrushRegular,
  Plug         as PlugRegular,
  Users        as PeopleRegular,
  Power        as PowerRegular,
  Router       as RouterRegular,
  Server       as ServerRegular,
  Shield       as ShieldRegular,
  Wrench       as WrenchRegular,
} from "@/components/icons/platform-icons";
import {
  AdvancedSection,
  AppearanceSection,
  BackupSection,
  DockerSection,
  GeneralSection,
  IntegrationsSection,
  NetworkSection,
  NotificationsSection,
  PowerSection,
  ScheduledTasksSection,
  SecuritySection,
  StorageSection,
  UpdatesSection,
  UsersSection,
} from "@/modules/settings/components/panel/sections";
import type {
  DesktopPreferencesApi,
  SettingsBackend,
  SettingsSection,
  SettingsSectionDefinition,
} from "@/modules/settings/components/panel/types";

export const SETTINGS_SECTIONS: SettingsSection[] = [
  // System
  { id: "general",          label: "General",          icon: ServerRegular       },
  { id: "appearance",       label: "Appearance",       icon: PaintBrushRegular   },
  { id: "updates",          label: "Updates",          icon: ArrowSyncRegular    },
  // Infrastructure
  { id: "network",          label: "Network",          icon: RouterRegular       },
  { id: "storage",          label: "Storage",          icon: HardDriveRegular    },
  { id: "docker",           label: "Docker",           icon: BoxRegular          },
  // Integrations
  { id: "integrations",     label: "Integrations",     icon: PlugRegular         },
  // Automation
  { id: "scheduled-tasks",  label: "Scheduled Tasks",  icon: CalendarClockRegular },
  { id: "backup",           label: "Backup & Restore", icon: DatabaseRegular     },
  // Access & Safety
  { id: "users",            label: "Users & Access",   icon: PeopleRegular       },
  { id: "security",         label: "Security",         icon: ShieldRegular       },
  { id: "notifications",    label: "Notifications",    icon: AlertRegular        },
  // Danger zone
  { id: "power",            label: "Power",            icon: PowerRegular        },
  { id: "advanced",         label: "Advanced",         icon: WrenchRegular       },
];

type SettingsRegistryContext = {
  appearance: Parameters<typeof AppearanceSection>[0]["appearance"];
  wallpaperOptions: Parameters<typeof AppearanceSection>[0]["wallpaperOptions"];
  accentOptions: Parameters<typeof AppearanceSection>[0]["accentOptions"];
  onAppearanceChange: Parameters<typeof AppearanceSection>[0]["onAppearanceChange"];
  wallpaperAccentColor: Parameters<typeof AppearanceSection>[0]["wallpaperAccentColor"];
  desktopPreferences: DesktopPreferencesApi;
  settingsBackend: SettingsBackend;
  onOpenDiskManager?: () => void;
  generalController: {
    draft: { hostname: string; timezone: string };
    setHostname: (value: string) => void;
    setTimezone: (value: string) => void;
    saveState: SettingsSectionDefinition["save"];
    save: () => Promise<void>;
  };
  securityController: {
    draft: Parameters<typeof SecuritySection>[0]["draft"];
    patchDraft: (patch: Partial<Parameters<typeof SecuritySection>[0]["draft"]>) => void;
    saveState: SettingsSectionDefinition["save"];
    save: () => Promise<void>;
  };
  notificationController: {
    draft: Parameters<typeof NotificationsSection>[0]["draft"];
    patchDraft: (patch: Partial<Parameters<typeof NotificationsSection>[0]["draft"]>) => void;
    saveState: SettingsSectionDefinition["save"];
    save: () => Promise<void>;
  };
  backupController: {
    draft: Parameters<typeof BackupSection>[0]["settingsDraft"];
    patchDraft: (patch: Partial<Parameters<typeof BackupSection>[0]["settingsDraft"]>) => void;
    saveState: SettingsSectionDefinition["save"];
    save: () => Promise<void>;
  };
};

function getDefaultSaveConfig(
  settingsBackend: SettingsBackend,
  sectionId: keyof SettingsBackend["capabilities"]["saveBySection"],
) {
  const visible = settingsBackend.capabilities.saveBySection[sectionId] ?? false;
  if (!visible) return undefined;

  return {
    canSave: false,
    title: settingsBackend.capabilities.saveDisabledReason,
    pending: false,
    label: "Save Changes",
    onSave: undefined,
  };
}

export function buildSettingsSectionDefinitions(
  context: SettingsRegistryContext,
): SettingsSectionDefinition[] {
  return [
    // ── System ──────────────────────────────────────────────────────────
    {
      ...SETTINGS_SECTIONS[0], // General
      render: () => (
        <GeneralSection
          data={context.settingsBackend.general}
          preferences={{
            ...context.settingsBackend.generalPreferences,
            hostname: context.generalController.draft.hostname,
            timezone: context.generalController.draft.timezone,
          }}
          capabilities={context.settingsBackend.capabilities.general}
          languageValue={context.desktopPreferences.languageLabel}
          languageOptions={context.desktopPreferences.languageOptions.map((o) => o.label)}
          onHostnameChange={context.generalController.setHostname}
          onTimezoneChange={context.generalController.setTimezone}
          weatherLocation={context.appearance.weatherLocation}
          onWeatherLocationChange={(weatherLocation) => context.onAppearanceChange({ weatherLocation })}
          onLanguageChange={(value) => {
            const next = context.desktopPreferences.languageOptions.find((o) => o.label === value);
            if (!next) return;
            context.desktopPreferences.setLanguage(next.code);
          }}
          timeFormatValue={context.desktopPreferences.timeFormatLabel}
          timeFormatOptions={context.desktopPreferences.timeFormatOptions.map((o) => o.label)}
          onTimeFormatChange={(value) => {
            const next = context.desktopPreferences.timeFormatOptions.find((o) => o.label === value);
            if (!next) return;
            context.desktopPreferences.setTimeFormat(next.value);
          }}
        />
      ),
      save: context.generalController.saveState
        ? { ...context.generalController.saveState, onSave: context.generalController.save }
        : getDefaultSaveConfig(context.settingsBackend, "general"),
    },
    {
      ...SETTINGS_SECTIONS[1], // Appearance
      liveApply: true,
      render: () => (
        <AppearanceSection
          appearance={context.appearance}
          wallpaperOptions={context.wallpaperOptions}
          accentOptions={context.accentOptions}
          onAppearanceChange={context.onAppearanceChange}
          wallpaperAccentColor={context.wallpaperAccentColor}
        />
      ),
    },
    {
      ...SETTINGS_SECTIONS[2], // Updates
      render: () => (
        <UpdatesSection
          data={context.settingsBackend.updates}
          capabilities={context.settingsBackend.capabilities.updates}
          onCheckForUpdates={context.settingsBackend.actions.checkForUpdates}
          onApplyUpdate={context.settingsBackend.actions.applySystemUpdate}
          autoCheckEnabled={context.desktopPreferences.preferences.autoCheckUpdates}
          onToggleAutoCheck={(enabled) => context.desktopPreferences.setAutoCheckUpdates(enabled)}
        />
      ),
      save: getDefaultSaveConfig(context.settingsBackend, "updates"),
    },

    // ── Infrastructure ───────────────────────────────────────────────────
    {
      ...SETTINGS_SECTIONS[3], // Network
      render: () => <NetworkSection data={context.settingsBackend.network} />,
      save: getDefaultSaveConfig(context.settingsBackend, "network"),
    },
    {
      ...SETTINGS_SECTIONS[4], // Storage
      render: () => <StorageSection data={context.settingsBackend.storage} onOpenDiskManager={context.onOpenDiskManager} />,
      save: getDefaultSaveConfig(context.settingsBackend, "storage"),
    },
    {
      ...SETTINGS_SECTIONS[5], // Docker
      render: () => (
        <DockerSection
          data={context.settingsBackend.docker}
          capabilities={context.settingsBackend.capabilities.docker}
          onPruneImages={context.settingsBackend.actions.pruneDockerImages}
          onPruneVolumes={context.settingsBackend.actions.pruneDockerVolumes}
        />
      ),
      save: getDefaultSaveConfig(context.settingsBackend, "docker"),
    },

    // ── Integrations ─────────────────────────────────────────────────────
    {
      ...SETTINGS_SECTIONS[6], // Integrations
      render: () => <IntegrationsSection />,
    },

    // ── Automation ───────────────────────────────────────────────────────
    {
      ...SETTINGS_SECTIONS[7], // Scheduled Tasks
      render: () => <ScheduledTasksSection />,
    },
    {
      ...SETTINGS_SECTIONS[8], // Backup & Restore
      render: () => (
        <BackupSection
          data={context.settingsBackend.backup}
          capabilities={context.settingsBackend.capabilities.backup}
          settingsDraft={context.backupController.draft}
          onSettingsChange={context.backupController.patchDraft}
          onRunBackupNow={context.settingsBackend.actions.runBackupNow}
          onRestoreBackup={context.settingsBackend.actions.restoreBackup}
        />
      ),
      save: context.backupController.saveState
        ? { ...context.backupController.saveState, onSave: context.backupController.save }
        : getDefaultSaveConfig(context.settingsBackend, "backup"),
    },

    // ── Access & Safety ──────────────────────────────────────────────────
    {
      ...SETTINGS_SECTIONS[9], // Users & Access
      render: () => (
        <UsersSection
          username={context.settingsBackend.general.username}
          twoFactor={context.settingsBackend.general.twoFactor}
          isDemoMode={context.settingsBackend.general.isDemoMode}
        />
      ),
      save: getDefaultSaveConfig(context.settingsBackend, "users"),
    },
    {
      ...SETTINGS_SECTIONS[10], // Security
      render: () => (
        <SecuritySection
          data={context.settingsBackend.security}
          draft={context.securityController.draft}
          onChange={context.securityController.patchDraft}
        />
      ),
      save: context.securityController.saveState
        ? { ...context.securityController.saveState, onSave: context.securityController.save }
        : getDefaultSaveConfig(context.settingsBackend, "security"),
    },
    {
      ...SETTINGS_SECTIONS[11], // Notifications
      render: () => (
        <NotificationsSection
          draft={context.notificationController.draft}
          onChange={context.notificationController.patchDraft}
        />
      ),
      save: context.notificationController.saveState
        ? { ...context.notificationController.saveState, onSave: context.notificationController.save }
        : getDefaultSaveConfig(context.settingsBackend, "notifications"),
    },

    // ── Danger zone ──────────────────────────────────────────────────────
    {
      ...SETTINGS_SECTIONS[12], // Power
      render: () => (
        <PowerSection
          power={context.settingsBackend.power}
          onRebootNow={context.settingsBackend.actions.rebootNow}
          onShutdownNow={context.settingsBackend.actions.shutdownNow}
          onSaveScheduledReboot={context.settingsBackend.actions.saveScheduledReboot}
          onFactoryReset={context.settingsBackend.actions.factoryReset}
        />
      ),
      save: getDefaultSaveConfig(context.settingsBackend, "power"),
    },
    {
      ...SETTINGS_SECTIONS[13], // Advanced
      render: () => <AdvancedSection />,
    },
  ];
}
