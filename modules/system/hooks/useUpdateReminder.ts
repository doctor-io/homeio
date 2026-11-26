"use client";

import { useEffect, useState } from "react";
import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import {
  UPDATE_REMINDER_SNOOZE_MS,
  readUpdateReminderSnooze,
  updateReminderSnoozeRemaining,
  writeUpdateReminderSnooze,
  type UpdateReminderSnooze,
} from "@/lib/desktop/update-reminder";
import { applySystemUpdateRequest } from "@/modules/settings/hooks/backend/api";
import { persistPowerActionState } from "@/modules/settings/hooks/useUpdateRecoveryState";
import { useSystemUpdateStatus } from "@/modules/system/hooks/useSystemUpdateStatus";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Drives the update bar above the dock: it shows while an update is available,
 * "Later" hides it for an hour per version, and it respects the existing
 * "Update notifications" preference.
 */
export function useUpdateReminder({ enabled }: { enabled: boolean }) {
  const { data: status } = useSystemUpdateStatus();
  const { notificationPreferences, isHydrated } = useDesktopPreferences();
  const [snooze, setSnooze] = useState<UpdateReminderSnooze | null>(null);
  const [isSnoozeLoaded, setIsSnoozeLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storage = browserStorage();
    setSnooze(storage ? readUpdateReminderSnooze(storage) : null);
    setIsSnoozeLoaded(true);
  }, []);

  const latestVersion = status?.updateAvailable ? status.latestVersion : null;
  const snoozeRemaining = latestVersion
    ? updateReminderSnoozeRemaining(snooze, latestVersion, now)
    : 0;

  // Wake up when the snooze runs out, so the reminder comes back without a reload.
  useEffect(() => {
    if (snoozeRemaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), snoozeRemaining);
    return () => window.clearTimeout(timer);
  }, [snoozeRemaining]);

  const visible =
    enabled &&
    isHydrated &&
    isSnoozeLoaded &&
    notificationPreferences.updateNotificationsEnabled &&
    latestVersion !== null &&
    snoozeRemaining === 0;

  function later() {
    if (!latestVersion) return;
    const timestamp = Date.now();
    const storage = browserStorage();
    setSnooze(
      storage
        ? writeUpdateReminderSnooze(storage, latestVersion, timestamp)
        : { version: latestVersion, snoozedUntil: timestamp + UPDATE_REMINDER_SNOOZE_MS },
    );
    setNow(timestamp);
    setError(null);
  }

  async function update() {
    if (isApplying || !latestVersion) return;
    setIsApplying(true);
    setError(null);

    try {
      await applySystemUpdateRequest(latestVersion);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start the update");
      setIsApplying(false);
      return;
    }

    // Same hand-off as Settings → Updates: the /updating page follows the restart.
    persistPowerActionState("update", {
      requestDispatchedAt: new Date().toISOString(),
    });
    window.location.replace("/updating");
  }

  return {
    visible,
    currentVersion: status?.currentVersion ?? null,
    latestVersion,
    canSelfUpdate: status?.canSelfUpdate !== false,
    isApplying,
    error,
    later,
    update,
  };
}
