"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  DESKTOP_PREFERENCES_STORAGE_KEY,
  DESKTOP_LANGUAGE_OPTIONS,
  DESKTOP_TIME_FORMAT_OPTIONS,
  readDesktopPreferences,
  writeDesktopPreferences,
  type DesktopNotificationPreferences,
  type DesktopTimeFormat,
} from "@/lib/desktop/preferences";

const DESKTOP_PREFERENCES_CHANGED_EVENT = "homeio:desktop-preferences";

export function useDesktopPreferences() {
  const [preferences, setPreferences] = useState(DEFAULT_DESKTOP_PREFERENCES);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setPreferences(readDesktopPreferences(window.localStorage));
    setIsHydrated(true);
  }, []);

  // Each caller holds its own copy, so a change made in Settings has to reach
  // the status bar and lock screen clocks without a reload.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => setPreferences(readDesktopPreferences(window.localStorage));
    window.addEventListener(DESKTOP_PREFERENCES_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DESKTOP_PREFERENCES_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;

    // Skip unchanged writes, or every synced copy would announce itself again.
    if (window.localStorage.getItem(DESKTOP_PREFERENCES_STORAGE_KEY) === JSON.stringify(preferences)) {
      return;
    }
    writeDesktopPreferences(window.localStorage, preferences);
    window.dispatchEvent(new Event(DESKTOP_PREFERENCES_CHANGED_EVENT));
  }, [isHydrated, preferences]);

  const languageLabel = useMemo(
    () =>
      DESKTOP_LANGUAGE_OPTIONS.find((option) => option.code === preferences.language)?.label ??
      DESKTOP_LANGUAGE_OPTIONS[0].label,
    [preferences.language],
  );

  const timeFormatLabel = useMemo(
    () =>
      DESKTOP_TIME_FORMAT_OPTIONS.find((option) => option.value === preferences.timeFormat)?.label ??
      DESKTOP_TIME_FORMAT_OPTIONS[0].label,
    [preferences.timeFormat],
  );

  return {
    preferences,
    isHydrated,
    languageLabel,
    languageOptions: DESKTOP_LANGUAGE_OPTIONS,
    timeFormatLabel,
    timeFormatOptions: DESKTOP_TIME_FORMAT_OPTIONS,
    setLanguage(language: (typeof DESKTOP_LANGUAGE_OPTIONS)[number]["code"]) {
      setPreferences((current) => ({
        ...current,
        language,
      }));
    },
    setTimeFormat(timeFormat: DesktopTimeFormat) {
      setPreferences((current) => ({
        ...current,
        timeFormat,
      }));
    },
    setAutoCheckUpdates(autoCheckUpdates: boolean) {
      setPreferences((current) => ({
        ...current,
        autoCheckUpdates,
      }));
    },
    notificationPreferences: preferences.notifications,
    setSystemAlertsEnabled(systemAlertsEnabled: boolean) {
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          systemAlertsEnabled,
        },
      }));
    },
    setUpdateNotificationsEnabled(updateNotificationsEnabled: boolean) {
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          updateNotificationsEnabled,
        },
      }));
    },
    setBackupReportsEnabled(backupReportsEnabled: boolean) {
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          backupReportsEnabled,
        },
      }));
    },
    setSecurityEventsEnabled(securityEventsEnabled: boolean) {
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          securityEventsEnabled,
        },
      }));
    },
    setCpuAlertThresholdPercent(cpuAlertThresholdPercent: number) {
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          cpuAlertThresholdPercent,
        },
      }));
    },
    setMemoryAlertThresholdPercent(memoryAlertThresholdPercent: number) {
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          memoryAlertThresholdPercent,
        },
      }));
    },
    setDiskAlertThresholdPercent(diskAlertThresholdPercent: number) {
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          diskAlertThresholdPercent,
        },
      }));
    },
    setTemperatureAlertThresholdCelsius(temperatureAlertThresholdCelsius: number) {
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          temperatureAlertThresholdCelsius,
        },
      }));
    },
    setNotificationPreferences(
      notifications:
        | DesktopNotificationPreferences
        | ((current: DesktopNotificationPreferences) => DesktopNotificationPreferences),
    ) {
      setPreferences((current) => ({
        ...current,
        notifications:
          typeof notifications === "function"
            ? notifications(current.notifications)
            : notifications,
      }));
    },
  };
}
