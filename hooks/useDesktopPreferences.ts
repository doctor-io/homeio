"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  DESKTOP_LANGUAGE_OPTIONS,
  DESKTOP_TIME_FORMAT_OPTIONS,
  readDesktopPreferences,
  writeDesktopPreferences,
  type DesktopNotificationPreferences,
  type DesktopTimeFormat,
} from "@/lib/desktop/preferences";

export function useDesktopPreferences() {
  const [preferences, setPreferences] = useState(DEFAULT_DESKTOP_PREFERENCES);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setPreferences(readDesktopPreferences(window.localStorage));
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;

    writeDesktopPreferences(window.localStorage, preferences);
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
