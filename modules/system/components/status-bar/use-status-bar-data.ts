"use client";

import { SECURITY_NOTIFICATION_TITLE } from "@/lib/shared/contracts/notifications";
import { useMemo } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import { useInstalledApps } from "@/modules/apps/hooks/useInstalledApps";
import { useNetworkStatus } from "@/modules/system/hooks/useNetworkStatus";
import { useSystemUpdateStatus } from "@/modules/system/hooks/useSystemUpdateStatus";
import { useSystemMetrics } from "@/modules/system/hooks/useSystemMetrics";
import { formatRelativeTime, safePercent } from "@/modules/system/components/status-bar/utils";
import { useStatusNotifications } from "@/modules/system/components/status-bar/use-status-notifications";
import { useNotifications } from "@/modules/system/hooks/useNotifications";
import type { Notification } from "@/modules/system/components/status-bar/types";
import type { NotificationRecord } from "@/lib/shared/contracts/notifications";

const MAX_MERGED_NOTIFICATIONS = 20;

/**
 * Persisted notifications and the client-side status ones are each ordered on
 * their own. Concatenating them produced two sorted runs end to end — app
 * events from yesterday sitting above a snapshot from minutes ago — so the
 * join has to be ordered too, not just the parts.
 */
export function mergeNotifications(
  persistent: NotificationRecord[],
  ephemeral: Notification[],
): Notification[] {
  const persistentIds = new Set(persistent.map((item) => item.id));
  const persistentMapped = persistent.map((item) => ({
    id: item.id,
    title: item.title,
    message: item.body,
    time: formatRelativeTime(item.createdAt),
    createdAt: item.createdAt,
    read: item.read,
  }));

  return [...persistentMapped, ...ephemeral.filter((item) => !persistentIds.has(item.id))]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_MERGED_NOTIFICATIONS);
}

export function useStatusBarData() {
  const { data: metrics, isError: isMetricsError } = useSystemMetrics();
  const { data: networkStatus, isError: isNetworkError } = useNetworkStatus();
  const { data: apps } = useInstalledApps();
  const { data: currentUser } = useCurrentUser();
  const { notificationPreferences } = useDesktopPreferences();
  const { data: systemUpdates } = useSystemUpdateStatus();

  const serverName = metrics?.hostname ?? "ServerLab";
  const cpuPercent = safePercent(metrics?.cpu.normalizedPercent);
  const memoryPercent = safePercent(metrics?.memory.usedPercent);
  const diskPercent = safePercent(metrics?.storage?.usedPercent);
  const stoppedAppsCount = (apps ?? []).filter(
    (app) => app.status === "stopped" || app.status === "paused",
  ).length;

  const batteryPercent =
    typeof metrics?.battery.percent === "number"
      ? safePercent(metrics.battery.percent)
      : null;
  const batteryText = metrics?.battery.hasBattery ? `${batteryPercent ?? "--"}%` : "AC";

  const isWifiConnected = Boolean(
    networkStatus?.connected ?? metrics?.wifi.connected,
  );
  const isEthernet = Boolean(
    (networkStatus?.connected ?? metrics?.wifi.connected) &&
      !(networkStatus?.ssid ?? metrics?.wifi.ssid),
  );
  const showWifiError = (isMetricsError && isNetworkError) || !isWifiConnected;
  const wifiIconClassName = showWifiError
    ? "size-4 text-status-red"
    : "size-4 text-status-green";

  const { notifications: persistentNotifications, unreadCount: persistentUnreadCount, markAllRead: markPersistentAllRead, clearAll: clearPersistentAll } = useNotifications();

  const { notifications: ephemeralNotifications, unreadCount: ephemeralUnreadCount, markAllRead: markEphemeralAllRead, clearAll: clearEphemeralAll } = useStatusNotifications({
    metricsTimestamp: metrics?.timestamp ?? null,
    cpuPercent,
    memoryPercent,
    diskPercent,
    temperatureCelsius:
      typeof metrics?.temperature.mainCelsius === "number"
        ? metrics.temperature.mainCelsius
        : null,
    stoppedAppsCount,
    updateAvailable: Boolean(systemUpdates?.updateAvailable),
    latestVersion: systemUpdates?.latestVersion ?? null,
    preferences: notificationPreferences,
  });

  const mergedNotifications = useMemo(() => {
    // The server records a failed-login burst whether or not anyone is watching
    // — it has no session to read a preference from, and an audit trail that a
    // setting can erase is not much of one. The toggle decides whether the
    // desktop surfaces them.
    const visiblePersistent = notificationPreferences.securityEventsEnabled
      ? persistentNotifications
      : persistentNotifications.filter(
          (n) => n.title !== SECURITY_NOTIFICATION_TITLE,
        );

    return mergeNotifications(visiblePersistent, ephemeralNotifications);
  }, [
    persistentNotifications,
    ephemeralNotifications,
    notificationPreferences.securityEventsEnabled,
  ]);

  const mergedUnreadCount = persistentUnreadCount + ephemeralUnreadCount;

  function markAllRead() {
    markPersistentAllRead();
    markEphemeralAllRead();
  }

  function clearAll() {
    clearPersistentAll();
    clearEphemeralAll();
  }

  return useMemo(
    () => ({
      metrics,
      networkStatus,
      serverName,
      isDemoMode: currentUser?.isDemoMode ?? false,
      username: currentUser?.isDemoMode ? "homeio" : (currentUser?.username ?? null),
      batteryText,
      isWifiConnected,
      isEthernet,
      isMetricsError,
      wifiIconClassName,
      notifications: mergedNotifications,
      unreadCount: mergedUnreadCount,
      markAllRead,
      clearNotifications: clearAll,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      batteryText,
      isMetricsError,
      networkStatus,
      isWifiConnected,
      isEthernet,
      metrics,
      mergedNotifications,
      mergedUnreadCount,
      serverName,
      currentUser?.username,
      currentUser?.isDemoMode,
      wifiIconClassName,
    ],
  );
}
