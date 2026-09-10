"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration, formatRelativeTime } from "@/modules/system/components/status-bar/utils";
import {
  DESKTOP_NOTIFICATION_EVENT,
  type DesktopNotificationEventDetail,
} from "@/lib/desktop/notification-events";
import type { DesktopNotificationPreferences } from "@/lib/desktop/preferences";
import type { Notification } from "@/modules/system/components/status-bar/types";

const ALERT_COOLDOWN_MS = 60_000;
const MAX_NOTIFICATIONS = 12;

type StoredNotification = Omit<Notification, "time"> & {
  createdAt: string;
};

type UseStatusNotificationsParams = {
  metricsTimestamp: string | null;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  temperatureCelsius: number | null;
  hostname: string;
  uptimeSeconds: number;
  stoppedAppsCount: number;
  username: string | undefined;
  updateAvailable: boolean;
  latestVersion: string | null;
  preferences: DesktopNotificationPreferences;
};

function toEventTimestamp(timestamp: string | null) {
  if (!timestamp) return new Date().toISOString();
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

function upsertNotification(
  items: StoredNotification[],
  nextItem: StoredNotification,
  options?: {
    preserveRead?: boolean;
    preserveCreatedAt?: boolean;
  },
) {
  const index = items.findIndex((item) => item.id === nextItem.id);

  if (index === -1) {
    items.push(nextItem);
    return;
  }

  const existing = items[index];
  items[index] = {
    ...nextItem,
    read: options?.preserveRead ? existing.read : nextItem.read,
    createdAt: options?.preserveCreatedAt ? existing.createdAt : nextItem.createdAt,
  };
}

function removeNotification(items: StoredNotification[], id: string) {
  const index = items.findIndex((item) => item.id === id);
  if (index !== -1) {
    items.splice(index, 1);
  }
}

export function useStatusNotifications({
  metricsTimestamp,
  cpuPercent,
  memoryPercent,
  diskPercent,
  temperatureCelsius,
  hostname,
  uptimeSeconds,
  stoppedAppsCount,
  username,
  updateAvailable,
  latestVersion,
  preferences,
}: UseStatusNotificationsParams) {
  const [storedNotifications, setStoredNotifications] = useState<StoredNotification[]>([]);
  const lastAlertAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const eventTimestamp = toEventTimestamp(metricsTimestamp);
    const eventTimeMs = Date.parse(eventTimestamp);

    setStoredNotifications((previous) => {
      const next = [...previous];

      if (metricsTimestamp) {
        upsertNotification(
          next,
          {
            id: "system-snapshot",
            title: "System Snapshot",
            message: `${hostname} · uptime ${formatDuration(uptimeSeconds)}`,
            read: true,
            createdAt: eventTimestamp,
          },
          { preserveCreatedAt: true },
        );
      } else {
        removeNotification(next, "system-snapshot");
      }

      if (preferences.systemAlertsEnabled && stoppedAppsCount > 0) {
        upsertNotification(
          next,
          {
            id: "apps-stopped",
            title: "Apps Attention",
            message: `${stoppedAppsCount} app(s) are stopped`,
            read: false,
            createdAt: eventTimestamp,
          },
          {
            preserveRead: true,
            preserveCreatedAt: true,
          },
        );
      } else {
        removeNotification(next, "apps-stopped");
      }

      if (username) {
        upsertNotification(
          next,
          {
            id: "session",
            title: "Active Session",
            message: `Signed in as ${username}`,
            read: true,
            createdAt: eventTimestamp,
          },
          { preserveCreatedAt: true },
        );
      } else {
        removeNotification(next, "session");
      }

      const maybeCreateAlert = (
        type: "cpu-warning" | "memory-warning" | "disk-warning" | "temperature-warning",
        isActive: boolean,
        title: string,
        message: string,
      ) => {
        if (!isActive || Number.isNaN(eventTimeMs)) return;

        const lastAlertAt = lastAlertAtRef.current[type] ?? 0;
        if (eventTimeMs - lastAlertAt < ALERT_COOLDOWN_MS) return;

        lastAlertAtRef.current[type] = eventTimeMs;
        next.push({
          id: `${type}-${eventTimeMs}`,
          title,
          message,
          read: false,
          createdAt: eventTimestamp,
        });
      };

      maybeCreateAlert(
        "memory-warning",
        preferences.systemAlertsEnabled &&
          memoryPercent >= preferences.memoryAlertThresholdPercent,
        "Memory Warning",
        `Memory usage is high at ${memoryPercent}%`,
      );

      maybeCreateAlert(
        "cpu-warning",
        preferences.systemAlertsEnabled && cpuPercent >= preferences.cpuAlertThresholdPercent,
        "CPU Warning",
        `CPU load peaked at ${cpuPercent}%`,
      );

      maybeCreateAlert(
        "disk-warning",
        preferences.systemAlertsEnabled && diskPercent >= preferences.diskAlertThresholdPercent,
        "Disk Warning",
        `Disk usage is high at ${diskPercent}%`,
      );

      maybeCreateAlert(
        "temperature-warning",
        preferences.systemAlertsEnabled &&
          temperatureCelsius !== null &&
          temperatureCelsius >= preferences.temperatureAlertThresholdCelsius,
        "Temperature Warning",
        `System temperature reached ${temperatureCelsius?.toFixed(1)} C`,
      );

      if (preferences.updateNotificationsEnabled && updateAvailable && latestVersion) {
        upsertNotification(
          next,
          {
            id: `homeio-update-${latestVersion}`,
            title: "Homeio Update Available",
            message: `Homeio ${latestVersion} is ready to install`,
            read: false,
            createdAt: eventTimestamp,
          },
          {
            preserveRead: true,
            preserveCreatedAt: true,
          },
        );
      } else {
        next
          .filter((item) => item.id.startsWith("homeio-update-"))
          .forEach((item) => removeNotification(next, item.id));
      }

      next.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      return next.slice(0, MAX_NOTIFICATIONS);
    });
  }, [
    cpuPercent,
    hostname,
    memoryPercent,
    metricsTimestamp,
    stoppedAppsCount,
    diskPercent,
    latestVersion,
    preferences,
    temperatureCelsius,
    uptimeSeconds,
    updateAvailable,
    username,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleDesktopNotification = (event: Event) => {
      const customEvent = event as CustomEvent<DesktopNotificationEventDetail>;
      const detail = customEvent.detail;
      if (!detail) return;
      if (detail.kind === "backup-report" && !preferences.backupReportsEnabled) {
        return;
      }

      setStoredNotifications((previous) => {
        const next = [...previous];
        upsertNotification(next, {
          id: detail.id,
          title: detail.title,
          message: detail.message,
          read: detail.read ?? false,
          createdAt: detail.createdAt ?? new Date().toISOString(),
        });
        next.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
        return next.slice(0, MAX_NOTIFICATIONS);
      });
    };

    window.addEventListener(DESKTOP_NOTIFICATION_EVENT, handleDesktopNotification as EventListener);
    return () => {
      window.removeEventListener(
        DESKTOP_NOTIFICATION_EVENT,
        handleDesktopNotification as EventListener,
      );
    };
  }, [preferences.backupReportsEnabled]);

  const markAllRead = useCallback(() => {
    setStoredNotifications((previous) =>
      previous.map((notification) => ({
        ...notification,
        read: true,
      })),
    );
  }, []);

  const clearAll = useCallback(() => {
    setStoredNotifications([]);
  }, []);

  const notifications = useMemo<Notification[]>(
    () =>
      storedNotifications.map((item) => ({
        id: item.id,
        title: item.title,
        message: item.message,
        read: item.read,
        time: formatRelativeTime(item.createdAt),
        createdAt: item.createdAt,
      })),
    [storedNotifications],
  );

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  return {
    notifications,
    unreadCount,
    markAllRead,
    clearAll,
  };
}
