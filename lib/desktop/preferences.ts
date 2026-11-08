export const DESKTOP_PREFERENCES_STORAGE_KEY = "desktop.preferences.v1";

export const DESKTOP_LANGUAGE_OPTIONS = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "de-DE", label: "Deutsch" },
  { code: "fr-FR", label: "Francais" },
  { code: "es-ES", label: "Espanol" },
  { code: "pt-PT", label: "Portugues" },
] as const;

export type DesktopLanguageCode = (typeof DESKTOP_LANGUAGE_OPTIONS)[number]["code"];

export const DESKTOP_TIME_FORMAT_OPTIONS = [
  { value: "12h", label: "12-hour (AM/PM)" },
  { value: "24h", label: "24-hour" },
] as const;

export type DesktopTimeFormat = (typeof DESKTOP_TIME_FORMAT_OPTIONS)[number]["value"];

export type DesktopPreferences = {
  language: DesktopLanguageCode;
  timeFormat: DesktopTimeFormat;
  autoCheckUpdates: boolean;
  notifications: DesktopNotificationPreferences;
};

export type DesktopNotificationPreferences = {
  systemAlertsEnabled: boolean;
  updateNotificationsEnabled: boolean;
  backupReportsEnabled: boolean;
  securityEventsEnabled: boolean;
  cpuAlertThresholdPercent: number;
  memoryAlertThresholdPercent: number;
  diskAlertThresholdPercent: number;
  temperatureAlertThresholdCelsius: number;
};

export const DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES: DesktopNotificationPreferences = {
  systemAlertsEnabled: true,
  updateNotificationsEnabled: true,
  backupReportsEnabled: true,
  securityEventsEnabled: false,
  cpuAlertThresholdPercent: 85,
  memoryAlertThresholdPercent: 85,
  diskAlertThresholdPercent: 90,
  temperatureAlertThresholdCelsius: 80,
};

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  language: "en-US",
  timeFormat: "12h",
  autoCheckUpdates: true,
  notifications: DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES,
};

export function defaultTimeFormatForLanguage(language: DesktopLanguageCode): DesktopTimeFormat {
  return language === "en-US" ? "12h" : "24h";
}

export function isDesktopTimeFormat(value: string): value is DesktopTimeFormat {
  return DESKTOP_TIME_FORMAT_OPTIONS.some((option) => option.value === value);
}

function parseThreshold(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function parseNotificationPreferences(
  value: unknown,
): DesktopNotificationPreferences {
  const parsed = value && typeof value === "object"
    ? (value as Partial<DesktopNotificationPreferences>)
    : {};

  return {
    systemAlertsEnabled:
      typeof parsed.systemAlertsEnabled === "boolean"
        ? parsed.systemAlertsEnabled
        : DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES.systemAlertsEnabled,
    updateNotificationsEnabled:
      typeof parsed.updateNotificationsEnabled === "boolean"
        ? parsed.updateNotificationsEnabled
        : DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES.updateNotificationsEnabled,
    backupReportsEnabled:
      typeof parsed.backupReportsEnabled === "boolean"
        ? parsed.backupReportsEnabled
        : DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES.backupReportsEnabled,
    securityEventsEnabled:
      typeof parsed.securityEventsEnabled === "boolean"
        ? parsed.securityEventsEnabled
        : DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES.securityEventsEnabled,
    cpuAlertThresholdPercent: parseThreshold(
      parsed.cpuAlertThresholdPercent,
      DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES.cpuAlertThresholdPercent,
      1,
      100,
    ),
    memoryAlertThresholdPercent: parseThreshold(
      parsed.memoryAlertThresholdPercent,
      DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES.memoryAlertThresholdPercent,
      1,
      100,
    ),
    diskAlertThresholdPercent: parseThreshold(
      parsed.diskAlertThresholdPercent,
      DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES.diskAlertThresholdPercent,
      1,
      100,
    ),
    temperatureAlertThresholdCelsius: parseThreshold(
      parsed.temperatureAlertThresholdCelsius,
      DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES.temperatureAlertThresholdCelsius,
      1,
      150,
    ),
  };
}

export function isDesktopLanguageCode(value: string): value is DesktopLanguageCode {
  return DESKTOP_LANGUAGE_OPTIONS.some((option) => option.code === value);
}

export function readDesktopPreferences(storage: Storage | undefined) {
  if (!storage) return DEFAULT_DESKTOP_PREFERENCES;

  try {
    const raw = storage.getItem(DESKTOP_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_DESKTOP_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<DesktopPreferences>;
    if (!parsed.language || !isDesktopLanguageCode(parsed.language)) {
      return DEFAULT_DESKTOP_PREFERENCES;
    }

    const timeFormat =
      parsed.timeFormat && isDesktopTimeFormat(parsed.timeFormat)
        ? parsed.timeFormat
        : defaultTimeFormatForLanguage(parsed.language);

    return {
      language: parsed.language,
      timeFormat,
      autoCheckUpdates:
        typeof parsed.autoCheckUpdates === "boolean"
          ? parsed.autoCheckUpdates
          : DEFAULT_DESKTOP_PREFERENCES.autoCheckUpdates,
      notifications: parseNotificationPreferences(parsed.notifications),
    } satisfies DesktopPreferences;
  } catch {
    return DEFAULT_DESKTOP_PREFERENCES;
  }
}

export function writeDesktopPreferences(
  storage: Storage | undefined,
  preferences: DesktopPreferences,
) {
  if (!storage) return;

  try {
    storage.setItem(DESKTOP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Best effort only.
  }
}
