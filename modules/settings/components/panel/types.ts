import type { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import type { useSettingsBackend } from "@/modules/settings/hooks/useSettingsBackend";
import type {
  AccentColorOption,
  AppearanceSettings,
  WallpaperOption,
} from "@/lib/desktop/appearance";
import type { SystemSecurityPolicy } from "@/lib/shared/contracts/system";
import type { ComponentType, ReactNode, SVGProps } from "react";

export type SettingsBackend = ReturnType<typeof useSettingsBackend>;
export type DesktopPreferencesApi = ReturnType<typeof useDesktopPreferences>;

export type SettingsSectionId =
  | "general"
  | "network"
  | "storage"
  | "docker"
  | "integrations"
  | "users"
  | "security"
  | "notifications"
  | "backup"
  | "updates"
  | "appearance"
  | "power"
  | "scheduled-tasks"
  | "advanced"
  | "about";

export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  badge?: string;
};

export type ControlAvailability = {
  disabled?: boolean;
  disabledReason?: string;
};

export type GeneralPreferencesDraft = {
  hostname: string;
  timezone: string;
};

export type SecuritySettingsDraft = {
  firewallEnabled: boolean;
  firewallIncomingPolicy: SystemSecurityPolicy;
  firewallOutgoingPolicy: SystemSecurityPolicy;
  fail2banEnabled: boolean;
  fail2banMaxRetries: string;
  fail2banBanDurationSeconds: string;
};

export type NotificationSettingsDraft = {
  systemAlertsEnabled: boolean;
  updateNotificationsEnabled: boolean;
  backupReportsEnabled: boolean;
  securityEventsEnabled: boolean;
  cpuAlertThresholdPercent: string;
  memoryAlertThresholdPercent: string;
  diskAlertThresholdPercent: string;
  temperatureAlertThresholdCelsius: string;
};

export type BackupFrequency = "daily" | "weekly";

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type BackupSettingsDraft = {
  enabled: boolean;
  frequency: BackupFrequency;
  dayOfWeek: DayOfWeek;
  time: string;
  retentionCount: string;
};

export type ScheduledRebootInput = {
  enabled: boolean;
  frequency: BackupFrequency;
  dayOfWeek: DayOfWeek;
  time: string;
};

export type SettingsPanelProps = {
  appearance: AppearanceSettings;
  wallpaperOptions: WallpaperOption[];
  accentOptions: AccentColorOption[];
  onAppearanceChange: (patch: Partial<AppearanceSettings>) => void;
  wallpaperAccentColor: string | null;
  selectedSection?: string | null;
  onOpenDiskManager?: () => void;
};

export type SettingsSectionSaveConfig = {
  canSave: boolean;
  title?: string;
  pending?: boolean;
  label?: string;
  onSave?: () => Promise<void>;
};

export type SettingsSectionDefinition = SettingsSection & {
  liveApply?: boolean;
  render: () => ReactNode;
  save?: SettingsSectionSaveConfig;
};

export const DAY_OF_WEEK_OPTIONS: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const SCHEDULE_TIME_OPTIONS = [
  "00:00",
  "01:00",
  "02:00",
  "03:00",
  "04:00",
  "05:00",
  "06:00",
  "07:00",
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
  "21:00",
  "22:00",
  "23:00",
] as const;
