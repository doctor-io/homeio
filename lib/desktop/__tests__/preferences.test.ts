import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES,
  DESKTOP_PREFERENCES_STORAGE_KEY,
  defaultTimeFormatForLanguage,
  readDesktopPreferences,
  writeDesktopPreferences,
} from "@/lib/desktop/preferences";

describe("desktop preferences", () => {
  it("falls back to default notification preferences when older storage is missing them", () => {
    const storage = {
      getItem(key: string) {
        if (key !== DESKTOP_PREFERENCES_STORAGE_KEY) return null;
        return JSON.stringify({
          language: "en-US",
          autoCheckUpdates: false,
        });
      },
    } as Storage;

    const preferences = readDesktopPreferences(storage);

    expect(preferences.notifications).toEqual(
      DEFAULT_DESKTOP_NOTIFICATION_PREFERENCES,
    );
  });

  it("defaults time format from language when storage is missing timeFormat", () => {
    const storage = {
      getItem(key: string) {
        if (key !== DESKTOP_PREFERENCES_STORAGE_KEY) return null;
        return JSON.stringify({
          language: "de-DE",
          autoCheckUpdates: true,
        });
      },
    } as Storage;

    expect(readDesktopPreferences(storage).timeFormat).toBe(
      defaultTimeFormatForLanguage("de-DE"),
    );
  });

  it("writes notification preferences", () => {
    let storedValue = "";
    const storage = {
      getItem() {
        return storedValue;
      },
      setItem(_key: string, value: string) {
        storedValue = value;
      },
    } as Storage;

    writeDesktopPreferences(storage, {
      language: "en-US",
      timeFormat: "24h",
      autoCheckUpdates: true,
      notifications: {
        systemAlertsEnabled: false,
        updateNotificationsEnabled: true,
        backupReportsEnabled: false,
        securityEventsEnabled: false,
        cpuAlertThresholdPercent: 70,
        memoryAlertThresholdPercent: 75,
        diskAlertThresholdPercent: 80,
        temperatureAlertThresholdCelsius: 65,
      },
    });

    const parsed = JSON.parse(storedValue) as {
      notifications: {
        cpuAlertThresholdPercent: number;
        diskAlertThresholdPercent: number;
      };
    };
    expect(parsed.notifications.cpuAlertThresholdPercent).toBe(70);
    expect(parsed.notifications.diskAlertThresholdPercent).toBe(80);
  });
});
