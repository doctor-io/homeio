"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BackupSettingsDraft,
  DesktopPreferencesApi,
  GeneralPreferencesDraft,
  NotificationSettingsDraft,
  SecuritySettingsDraft,
  SettingsBackend,
  SettingsSectionId,
} from "@/modules/settings/components/panel/types";
import {
  areNotificationThresholdsValid,
  areSecurityNumbersValid,
  getBackupSaveTitle,
  getGeneralSaveTitle,
  getNotificationsSaveTitle,
  getSecuritySaveTitle,
  isBackupRetentionCountValid,
  isBackupTimeValid,
  isValidHostname,
  normalizeHostnameDraft,
  parseBackupRetentionCount,
  parseNotificationThresholds,
  parseSecurityDraft,
} from "@/modules/settings/components/panel/save-policies";

export function useGeneralSettingsController(
  generalPreferences: SettingsBackend["generalPreferences"],
  saveGeneralPreferences: SettingsBackend["actions"]["saveGeneralPreferences"],
) {
  const [draft, setDraft] = useState<GeneralPreferencesDraft>({
    hostname: generalPreferences.hostname,
    timezone: generalPreferences.timezone,
  });

  useEffect(() => {
    setDraft({
      hostname: generalPreferences.hostname,
      timezone: generalPreferences.timezone,
    });
  }, [generalPreferences.hostname, generalPreferences.timezone]);

  const normalizedHostname = normalizeHostnameDraft(draft.hostname);
  const draftChanged =
    normalizedHostname !== generalPreferences.hostname ||
    draft.timezone !== generalPreferences.timezone;
  const canSave =
    draftChanged &&
    isValidHostname(normalizedHostname) &&
    !generalPreferences.isLoading &&
    !generalPreferences.isSaving;

  return {
    draft,
    setHostname(hostname: string) {
      setDraft((current) => ({
        ...current,
        hostname,
      }));
    },
    setTimezone(timezone: string) {
      setDraft((current) => ({
        ...current,
        timezone,
      }));
    },
    saveState: {
      canSave,
      title: getGeneralSaveTitle({ draft, data: generalPreferences }),
      pending: generalPreferences.isSaving,
      label: generalPreferences.isSaving ? "Saving..." : "Save Changes",
    },
    async save() {
      if (!canSave) return;

      await saveGeneralPreferences({
        hostname: normalizedHostname || "homeio",
        timezone: draft.timezone,
      });
    },
  };
}

export function useSecuritySettingsController(
  security: SettingsBackend["security"],
  saveSecuritySettings: SettingsBackend["actions"]["saveSecuritySettings"],
) {
  const [draft, setDraft] = useState<SecuritySettingsDraft>({
    firewallEnabled: security.firewall.enabled,
    firewallIncomingPolicy: security.firewall.incomingPolicy,
    firewallOutgoingPolicy: security.firewall.outgoingPolicy,
    fail2banEnabled: security.fail2ban.enabled,
    fail2banMaxRetries: String(security.fail2ban.maxRetries),
    fail2banBanDurationSeconds: String(security.fail2ban.banDuration),
  });

  useEffect(() => {
    setDraft({
      firewallEnabled: security.firewall.enabled,
      firewallIncomingPolicy: security.firewall.incomingPolicy,
      firewallOutgoingPolicy: security.firewall.outgoingPolicy,
      fail2banEnabled: security.fail2ban.enabled,
      fail2banMaxRetries: String(security.fail2ban.maxRetries),
      fail2banBanDurationSeconds: String(security.fail2ban.banDuration),
    });
  }, [
    security.fail2ban.banDuration,
    security.fail2ban.enabled,
    security.fail2ban.maxRetries,
    security.firewall.enabled,
    security.firewall.incomingPolicy,
    security.firewall.outgoingPolicy,
  ]);

  const parsedDraft = parseSecurityDraft(draft);
  const draftChanged =
    draft.firewallEnabled !== security.firewall.enabled ||
    draft.firewallIncomingPolicy !== security.firewall.incomingPolicy ||
    draft.firewallOutgoingPolicy !== security.firewall.outgoingPolicy ||
    draft.fail2banEnabled !== security.fail2ban.enabled ||
    parsedDraft.maxRetries !== security.fail2ban.maxRetries ||
    parsedDraft.banDuration !== security.fail2ban.banDuration;
  const canSave =
    draftChanged &&
    areSecurityNumbersValid(draft) &&
    !security.isLoading &&
    !security.isSaving &&
    !security.unavailable;

  return {
    draft,
    patchDraft(patch: Partial<SecuritySettingsDraft>) {
      setDraft((current) => ({
        ...current,
        ...patch,
      }));
    },
    saveState: {
      canSave,
      title: getSecuritySaveTitle({ draft, data: security }),
      pending: security.isSaving,
      label: security.isSaving ? "Saving..." : "Save Changes",
    },
    async save() {
      if (!canSave) return;

      await saveSecuritySettings({
        firewallEnabled: draft.firewallEnabled,
        firewallIncomingPolicy: draft.firewallIncomingPolicy,
        firewallOutgoingPolicy: draft.firewallOutgoingPolicy,
        fail2banEnabled: draft.fail2banEnabled,
        fail2banMaxRetries: parsedDraft.maxRetries,
        fail2banBanDurationSeconds: parsedDraft.banDuration,
      });
    },
  };
}

export function useBackupSettingsController(
  backupSettings: SettingsBackend["backup"]["settings"],
  saveBackupSettings: SettingsBackend["actions"]["saveBackupSettings"],
) {
  const [draft, setDraft] = useState<BackupSettingsDraft>({
    enabled: backupSettings.enabled,
    frequency: backupSettings.frequency,
    dayOfWeek: backupSettings.dayOfWeek,
    time: backupSettings.time,
    retentionCount: String(backupSettings.retentionCount),
  });

  useEffect(() => {
    setDraft({
      enabled: backupSettings.enabled,
      frequency: backupSettings.frequency,
      dayOfWeek: backupSettings.dayOfWeek,
      time: backupSettings.time,
      retentionCount: String(backupSettings.retentionCount),
    });
  }, [
    backupSettings.dayOfWeek,
    backupSettings.enabled,
    backupSettings.frequency,
    backupSettings.retentionCount,
    backupSettings.time,
  ]);

  const retentionCount = parseBackupRetentionCount(draft);
  const draftChanged =
    draft.enabled !== backupSettings.enabled ||
    draft.frequency !== backupSettings.frequency ||
    draft.dayOfWeek !== backupSettings.dayOfWeek ||
    draft.time !== backupSettings.time ||
    retentionCount !== backupSettings.retentionCount;
  const canSave =
    draftChanged &&
    isBackupTimeValid(draft.time) &&
    isBackupRetentionCountValid(retentionCount) &&
    !backupSettings.isLoading &&
    !backupSettings.isSaving;

  return {
    draft,
    patchDraft(patch: Partial<BackupSettingsDraft>) {
      setDraft((current) => ({
        ...current,
        ...patch,
      }));
    },
    saveState: {
      canSave,
      title: getBackupSaveTitle({ draft, data: backupSettings }),
      pending: backupSettings.isSaving,
      label: backupSettings.isSaving ? "Saving..." : "Save Changes",
    },
    async save() {
      if (!canSave) return;

      await saveBackupSettings({
        enabled: draft.enabled,
        frequency: draft.frequency,
        dayOfWeek: draft.dayOfWeek,
        time: draft.time,
        retentionCount,
      });
    },
  };
}

export function useNotificationSettingsController(
  desktopPreferences: DesktopPreferencesApi,
) {
  const [draft, setDraft] = useState<NotificationSettingsDraft>({
    systemAlertsEnabled:
      desktopPreferences.notificationPreferences.systemAlertsEnabled,
    updateNotificationsEnabled:
      desktopPreferences.notificationPreferences.updateNotificationsEnabled,
    backupReportsEnabled:
      desktopPreferences.notificationPreferences.backupReportsEnabled,
    securityEventsEnabled:
      desktopPreferences.notificationPreferences.securityEventsEnabled,
    cpuAlertThresholdPercent: String(
      desktopPreferences.notificationPreferences.cpuAlertThresholdPercent,
    ),
    memoryAlertThresholdPercent: String(
      desktopPreferences.notificationPreferences.memoryAlertThresholdPercent,
    ),
    diskAlertThresholdPercent: String(
      desktopPreferences.notificationPreferences.diskAlertThresholdPercent,
    ),
    temperatureAlertThresholdCelsius: String(
      desktopPreferences.notificationPreferences.temperatureAlertThresholdCelsius,
    ),
  });

  useEffect(() => {
    setDraft({
      systemAlertsEnabled:
        desktopPreferences.notificationPreferences.systemAlertsEnabled,
      updateNotificationsEnabled:
        desktopPreferences.notificationPreferences.updateNotificationsEnabled,
      backupReportsEnabled:
        desktopPreferences.notificationPreferences.backupReportsEnabled,
      securityEventsEnabled:
        desktopPreferences.notificationPreferences.securityEventsEnabled,
      cpuAlertThresholdPercent: String(
        desktopPreferences.notificationPreferences.cpuAlertThresholdPercent,
      ),
      memoryAlertThresholdPercent: String(
        desktopPreferences.notificationPreferences.memoryAlertThresholdPercent,
      ),
      diskAlertThresholdPercent: String(
        desktopPreferences.notificationPreferences.diskAlertThresholdPercent,
      ),
      temperatureAlertThresholdCelsius: String(
        desktopPreferences.notificationPreferences.temperatureAlertThresholdCelsius,
      ),
    });
  }, [desktopPreferences.notificationPreferences]);

  const thresholds = parseNotificationThresholds(draft);
  const draftChanged =
    draft.systemAlertsEnabled !==
      desktopPreferences.notificationPreferences.systemAlertsEnabled ||
    draft.updateNotificationsEnabled !==
      desktopPreferences.notificationPreferences.updateNotificationsEnabled ||
    draft.backupReportsEnabled !==
      desktopPreferences.notificationPreferences.backupReportsEnabled ||
    thresholds.cpu !==
      desktopPreferences.notificationPreferences.cpuAlertThresholdPercent ||
    thresholds.memory !==
      desktopPreferences.notificationPreferences.memoryAlertThresholdPercent ||
    thresholds.disk !==
      desktopPreferences.notificationPreferences.diskAlertThresholdPercent ||
    thresholds.temperature !==
      desktopPreferences.notificationPreferences.temperatureAlertThresholdCelsius;
  const canSave =
    desktopPreferences.isHydrated &&
    draftChanged &&
    areNotificationThresholdsValid(draft);

  return {
    draft,
    patchDraft(patch: Partial<NotificationSettingsDraft>) {
      setDraft((current) => ({
        ...current,
        ...patch,
      }));
    },
    saveState: {
      canSave,
      title: getNotificationsSaveTitle(draft),
      pending: false,
      label: "Save Changes",
    },
    async save() {
      if (!canSave) return;

      desktopPreferences.setNotificationPreferences((current) => ({
        ...current,
        systemAlertsEnabled: draft.systemAlertsEnabled,
        updateNotificationsEnabled: draft.updateNotificationsEnabled,
        backupReportsEnabled: draft.backupReportsEnabled,
        securityEventsEnabled: current.securityEventsEnabled,
        cpuAlertThresholdPercent: thresholds.cpu,
        memoryAlertThresholdPercent: thresholds.memory,
        diskAlertThresholdPercent: thresholds.disk,
        temperatureAlertThresholdCelsius: thresholds.temperature,
      }));
    },
  };
}

export function useUpdatesAutoCheckEffect(args: {
  activeSection: SettingsSectionId;
  isHydrated: boolean;
  autoCheckEnabled: boolean;
  onCheckForUpdates: () => void;
}) {
  const { activeSection, isHydrated, autoCheckEnabled, onCheckForUpdates } =
    args;
  const updatesAutoCheckTriggeredRef = useRef(false);

  useEffect(() => {
    if (activeSection !== "updates" || !isHydrated) {
      updatesAutoCheckTriggeredRef.current = false;
      return;
    }

    if (!autoCheckEnabled) {
      updatesAutoCheckTriggeredRef.current = false;
      return;
    }

    if (updatesAutoCheckTriggeredRef.current) {
      return;
    }

    updatesAutoCheckTriggeredRef.current = true;
    onCheckForUpdates();
  }, [activeSection, autoCheckEnabled, isHydrated, onCheckForUpdates]);
}
