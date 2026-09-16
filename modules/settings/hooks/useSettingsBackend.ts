"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { dispatchDesktopNotificationEvent } from "@/lib/desktop/notification-events";
import {
  SYSTEM_SECURITY_BAN_DURATION_MAX,
  SYSTEM_SECURITY_BAN_DURATION_MIN,
  SYSTEM_SECURITY_MAX_RETRIES_MAX,
  SYSTEM_SECURITY_MAX_RETRIES_MIN,
  SYSTEM_SECURITY_POLICY_OPTIONS,
  SYSTEM_TIMEZONE_OPTIONS,
  type SystemBackupListResponse,
  type SystemBackupSettings,
  type SystemPreferences,
  type SystemSecuritySettings,
  type SystemUpdateStatus,
} from "@/lib/shared/contracts/system";
import { queryKeys } from "@/lib/shared/query-keys";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  applySystemUpdateRequest,
  checkSystemUpdatesRequest,
  factoryResetRequest,
  fetchPowerCapabilitiesRequest,
  fetchScheduledRebootRequest,
  fetchSystemBackupsRequest,
  fetchSystemPreferencesRequest,
  fetchSystemSecurityRequest,
  fetchSystemUpdatesRequest,
  pruneDockerImagesRequest,
  pruneDockerVolumesRequest,
  rebootNowRequest,
  restoreBackupRequest,
  runBackupNowRequest,
  saveBackupSettingsRequest,
  saveScheduledRebootRequest,
  saveSystemPreferencesRequest,
  saveSystemSecurityRequest,
  shutdownNowRequest,
} from "@/modules/settings/hooks/backend/api";
import {
  CHECK_UPDATES_COOLDOWN_MS,
  DEFAULT_BACKUP_ROOT,
  DEFAULT_SCHEDULED_REBOOT_CONFIG,
} from "@/modules/settings/hooks/backend/constants";
import { createSettingsCapabilities } from "@/modules/settings/hooks/backend/capabilities";
import {
  formatBytes,
  formatGigabytes,
  formatUptime,
  mapContainerToViewModel,
} from "@/modules/settings/hooks/backend/formatters";
import type { ScheduledRebootConfig } from "@/modules/settings/hooks/backend/types";
import {
  persistPowerActionState,
  useUpdateRecoveryState,
} from "@/modules/settings/hooks/useUpdateRecoveryState";
import { useDockerStatsSnapshot } from "@/modules/system/hooks/useDockerStats";
import { useDockerInfo } from "@/modules/system/hooks/useDockerInfo";
import { useLocalFolderShares } from "@/modules/files/hooks/useLocalFolderShares";
import { useNetworkStatus } from "@/modules/system/hooks/useNetworkStatus";
import { useNetworkShares } from "@/modules/files/hooks/useNetworkShares";
import { useSystemMetrics } from "@/modules/system/hooks/useSystemMetrics";
import { useWifiNetworks } from "@/modules/system/hooks/useWifiNetworks";
import { useElevation } from "@/modules/auth/elevation/elevation-provider";

export function useSettingsBackend() {
  const { runElevated } = useElevation();
  const queryClient = useQueryClient();
  const { isUpdateRecoveryActive, setIsUpdateRecoveryActive } = useUpdateRecoveryState();

  const currentUserQuery = useCurrentUser();
  const systemMetricsQuery = useSystemMetrics();
  const networkStatusQuery = useNetworkStatus();
  const wifiNetworksQuery = useWifiNetworks();
  const localFolderSharesQuery = useLocalFolderShares();
  const networkSharesQuery = useNetworkShares();
  const dockerStatsSnapshot = useDockerStatsSnapshot();
  const dockerInfoQuery = useDockerInfo();
  const systemUpdatesQuery = useQuery({
    queryKey: queryKeys.systemUpdates,
    queryFn: fetchSystemUpdatesRequest,
    staleTime: 60_000,
    enabled: !isUpdateRecoveryActive,
  });
  const systemPreferencesQuery = useQuery({
    queryKey: queryKeys.systemPreferences,
    queryFn: fetchSystemPreferencesRequest,
    staleTime: 60_000,
  });
  const systemSecurityQuery = useQuery({
    queryKey: queryKeys.systemSecurity,
    queryFn: fetchSystemSecurityRequest,
    staleTime: 60_000,
  });
  const backupsQuery = useQuery({
    queryKey: queryKeys.systemBackups,
    queryFn: fetchSystemBackupsRequest,
    staleTime: 60_000,
  });
  const scheduledRebootQuery = useQuery({
    queryKey: queryKeys.powerSchedule,
    queryFn: fetchScheduledRebootRequest,
    staleTime: 60_000,
  });
  const powerCapabilitiesQuery = useQuery({
    queryKey: queryKeys.powerCapabilities,
    queryFn: fetchPowerCapabilitiesRequest,
    staleTime: 5 * 60_000,
  });

  const lastCheckedAtRef = useRef<number | null>(null);

  const checkUpdatesMutation = useMutation({
    mutationFn: checkSystemUpdatesRequest,
    onSuccess: async (data) => {
      lastCheckedAtRef.current = Date.now();
      queryClient.setQueryData(queryKeys.systemUpdates, data);
      await queryClient.invalidateQueries({ queryKey: queryKeys.systemUpdates });
    },
  });

  const applySystemUpdateMutation = useMutation({
    mutationFn: applySystemUpdateRequest,
  });

  const systemPreferencesMutation = useMutation({
    mutationFn: saveSystemPreferencesRequest,
    onSuccess: async (data) => {
      queryClient.setQueryData(queryKeys.systemPreferences, data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.systemPreferences }),
        queryClient.invalidateQueries({ queryKey: queryKeys.systemMetrics }),
      ]);
    },
  });

  const systemSecurityMutation = useMutation({
    mutationFn: saveSystemSecurityRequest,
    onSuccess: async (data) => {
      queryClient.setQueryData(queryKeys.systemSecurity, data);
      await queryClient.invalidateQueries({ queryKey: queryKeys.systemSecurity });
    },
  });

  const rebootMutation = useMutation({
    mutationFn: rebootNowRequest,
    onSuccess: () => {
      persistPowerActionState("reboot");
    },
  });

  const shutdownMutation = useMutation({
    mutationFn: shutdownNowRequest,
    onSuccess: () => {
      persistPowerActionState("shutdown");
    },
  });

  const factoryResetMutation = useMutation({
    mutationFn: factoryResetRequest,
    onSuccess: () => {
      persistPowerActionState("factory-reset");
    },
  });

  const scheduledRebootMutation = useMutation({
    mutationFn: saveScheduledRebootRequest,
    onSuccess: async (data) => {
      queryClient.setQueryData(queryKeys.powerSchedule, data);
      await queryClient.invalidateQueries({ queryKey: queryKeys.powerSchedule });
    },
  });

  const pruneImagesMutation = useMutation({
    mutationFn: pruneDockerImagesRequest,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dockerInfo }),
        queryClient.invalidateQueries({ queryKey: queryKeys.systemMetrics }),
      ]);
    },
  });

  const pruneVolumesMutation = useMutation({
    mutationFn: pruneDockerVolumesRequest,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dockerInfo }),
        queryClient.invalidateQueries({ queryKey: queryKeys.systemMetrics }),
      ]);
    },
  });

  const backupSettingsMutation = useMutation({
    mutationFn: saveBackupSettingsRequest,
    onSuccess: async (data) => {
      queryClient.setQueryData<SystemBackupListResponse | undefined>(
        queryKeys.systemBackups,
        (current) =>
          current
            ? {
                ...current,
                settings: data,
              }
            : {
                settings: data,
                backups: [],
                backupRoot: DEFAULT_BACKUP_ROOT,
              },
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.systemBackups });
    },
  });

  const backupRunMutation = useMutation({
    mutationFn: runBackupNowRequest,
    onSuccess: async (data) => {
      dispatchDesktopNotificationEvent({
        id: `backup-run-${data.backup.id}`,
        title: "Backup Completed",
        message: `Backup ${data.backup.id} finished successfully.`,
        kind: "backup-report",
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.systemBackups });
    },
    onError: (error) => {
      dispatchDesktopNotificationEvent({
        id: `backup-run-error-${Date.now()}`,
        title: "Backup Failed",
        message: error instanceof Error ? error.message : "Backup run failed.",
        kind: "backup-report",
      });
    },
  });

  const restoreBackupMutation = useMutation({
    mutationFn: restoreBackupRequest,
    onSuccess: (_data, backupId) => {
      dispatchDesktopNotificationEvent({
        id: `backup-restore-${backupId}`,
        title: "Restore Scheduled",
        message: `Restore from backup ${backupId} was accepted. Homeio will restart to finish it.`,
        kind: "backup-report",
      });
      persistPowerActionState("restore");
    },
    onError: (error, backupId) => {
      dispatchDesktopNotificationEvent({
        id: `backup-restore-error-${backupId}-${Date.now()}`,
        title: "Restore Failed",
        message: error instanceof Error ? error.message : `Restore from ${backupId} failed.`,
        kind: "backup-report",
      });
    },
  });

  async function checkForUpdates() {
    if (checkUpdatesMutation.isPending || isUpdateRecoveryActive) return;

    const lastChecked = lastCheckedAtRef.current;
    if (lastChecked !== null && Date.now() - lastChecked < CHECK_UPDATES_COOLDOWN_MS) {
      const currentStatus = queryClient.getQueryData<SystemUpdateStatus>(queryKeys.systemUpdates);
      if (currentStatus?.updateAvailable && currentStatus.latestVersion) {
        toast.success(`Homeio ${currentStatus.latestVersion} is available.`);
      } else if (currentStatus?.latestVersion) {
        toast.success("Homeio is already up to date.");
      } else {
        toast.info("Update check ran recently. Please wait a moment before trying again.");
      }
      return;
    }

    try {
      const data = await checkUpdatesMutation.mutateAsync(undefined);
      if (data.updateAvailable && data.latestVersion) {
        toast.success(`Homeio ${data.latestVersion} is available.`);
      } else {
        toast.success("Homeio is already up to date.");
      }
      return data;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to check for Homeio updates.",
      );
      throw error;
    }
  }

  const general = useMemo(() => {
    const metrics = systemMetricsQuery.data;
    const memory = metrics?.memory;
    const systemPreferences = systemPreferencesQuery.data;

    return {
      hostname: systemPreferences?.hostname ?? metrics?.hostname ?? "--",
      platform: metrics?.platform ?? "--",
      kernel: metrics?.process.nodeVersion ?? "--",
      architecture: metrics?.architecture ?? "--",
      uptime: formatUptime(metrics?.uptimeSeconds),
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "--",
      username: currentUserQuery.data?.username ?? "--",
      twoFactor: currentUserQuery.data?.twoFactor ?? { enabled: false, enrolledAt: null },
      isDemoMode: currentUserQuery.data?.isDemoMode ?? false,
      cpuSummary:
        metrics?.cpu.normalizedPercent !== undefined
          ? `${metrics.cpu.normalizedPercent.toFixed(0)}% load`
          : "--",
      memorySummary:
        memory && memory.totalBytes > 0
          ? `${formatGigabytes(memory.usedBytes)} / ${formatGigabytes(memory.totalBytes)}`
          : "--",
      temperatureSummary:
        metrics?.temperature.mainCelsius !== null && metrics?.temperature.mainCelsius !== undefined
          ? `${metrics.temperature.mainCelsius.toFixed(1)} C`
          : "--",
      processUptime: formatUptime(metrics?.process.uptimeSeconds),
      isLoading:
        systemMetricsQuery.isLoading ||
        currentUserQuery.isLoading ||
        systemPreferencesQuery.isLoading,
      unavailable: Boolean(systemMetricsQuery.error) || Boolean(systemPreferencesQuery.error),
      warning:
        systemMetricsQuery.error instanceof Error
          ? "System metrics unavailable. Showing placeholders where needed."
          : systemPreferencesQuery.error instanceof Error
            ? "System preferences unavailable."
            : currentUserQuery.error instanceof Error
              ? "User identity unavailable."
              : null,
    };
  }, [
    currentUserQuery.data?.username,
    currentUserQuery.data?.twoFactor,
    currentUserQuery.data?.isDemoMode,
    currentUserQuery.error,
    currentUserQuery.isLoading,
    systemPreferencesQuery.data,
    systemPreferencesQuery.error,
    systemPreferencesQuery.isLoading,
    systemMetricsQuery.data,
    systemMetricsQuery.error,
    systemMetricsQuery.isLoading,
  ]);

  const network = useMemo(() => {
    const status = networkStatusQuery.data;
    const networks = wifiNetworksQuery.data ?? [];

    return {
      connected: status?.connected ?? false,
      iface: status?.iface ?? "--",
      ipv4: status?.ipv4 ?? "--",
      ssid: status?.ssid ?? "--",
      signalPercent:
        status?.signalPercent !== null && status?.signalPercent !== undefined
          ? `${status.signalPercent}%`
          : "--",
      wifiCount: networks.length,
      topSsids: networks
        .map((networkEntry) => networkEntry.ssid)
        .filter((ssid) => ssid.trim().length > 0)
        .slice(0, 3),
      isLoading: networkStatusQuery.isLoading || wifiNetworksQuery.isLoading,
      unavailable: Boolean(networkStatusQuery.error),
      warning:
        networkStatusQuery.error instanceof Error
          ? "Network status unavailable."
          : wifiNetworksQuery.error instanceof Error
            ? "Wi-Fi scan unavailable."
            : null,
    };
  }, [
    networkStatusQuery.data,
    networkStatusQuery.error,
    networkStatusQuery.isLoading,
    wifiNetworksQuery.data,
    wifiNetworksQuery.error,
    wifiNetworksQuery.isLoading,
  ]);

  const docker = useMemo(() => {
    const containers = dockerStatsSnapshot.stats.map(mapContainerToViewModel);
    const info = dockerInfoQuery.data;

    return {
      containers,
      total: containers.length,
      running: containers.filter((container) => container.status === "running").length,
      images: info ? String(info.images) : "--",
      engineVersion: info?.engineVersion ?? "--",
      composeVersion: info?.composeVersion ?? "--",
      storageDriver: info?.storageDriver ?? "--",
      cgroupDriver: info?.cgroupDriver ?? "--",
      isLoading: dockerStatsSnapshot.isLoading || dockerInfoQuery.isLoading,
      unavailable: Boolean(dockerStatsSnapshot.error),
      warning: dockerStatsSnapshot.error
        ? "Docker stats unavailable."
        : dockerInfoQuery.error
          ? "Docker engine info unavailable."
          : null,
      pruneImages: {
        isPending: pruneImagesMutation.isPending,
        error:
          pruneImagesMutation.error instanceof Error
            ? pruneImagesMutation.error.message
            : null,
      },
      pruneVolumes: {
        isPending: pruneVolumesMutation.isPending,
        error:
          pruneVolumesMutation.error instanceof Error
            ? pruneVolumesMutation.error.message
            : null,
      },
    };
  }, [
    dockerInfoQuery.data,
    dockerInfoQuery.error,
    dockerInfoQuery.isLoading,
    dockerStatsSnapshot.error,
    dockerStatsSnapshot.isLoading,
    dockerStatsSnapshot.stats,
    pruneImagesMutation.error,
    pruneImagesMutation.isPending,
    pruneVolumesMutation.error,
    pruneVolumesMutation.isPending,
  ]);

  const storage = useMemo(() => {
    const rootStorage = systemMetricsQuery.data?.storage;
    const disks = (rootStorage?.volumes ?? []).map((volume) => ({
      id: volume.id,
      label: volume.label,
      mountPath: volume.mountPath,
      totalBytes: volume.totalBytes,
      usedBytes: volume.usedBytes,
      usedPercent: volume.usedPercent,
      mediaType: volume.mediaType,
      filesystem: volume.filesystem,
    }));
    const localFolderShares = localFolderSharesQuery.data ?? [];
    const networkShares = networkSharesQuery.data ?? [];
    const shares = [
      ...localFolderShares.map((share) => ({
        id: share.id,
        name: share.shareName,
        path: `/${share.sharedPath}`,
        source: `/${share.sourcePath}`,
        protocol: "SMB usershare",
        status:
          share.isMounted && share.isExported
            ? "Mounted"
            : share.isMounted
              ? "Partially configured"
              : "Unmounted",
      })),
      ...networkShares.map((share) => ({
        id: share.id,
        name: `${share.host}/${share.share}`,
        path: `/${share.mountPath}`,
        source: `//${share.host}/${share.share}`,
        protocol: "SMB/CIFS",
        status: share.isMounted ? "Mounted" : "Unmounted",
      })),
    ].sort((left, right) => left.name.localeCompare(right.name));

    const warnings: string[] = [];
    if (systemMetricsQuery.error) warnings.push("Storage metrics unavailable.");
    if (localFolderSharesQuery.error) {
      warnings.push("Local shared folders list unavailable.");
    }
    if (networkSharesQuery.error) {
      warnings.push("Network shares list unavailable.");
    }

    return {
      mountPath: rootStorage?.mountPath ?? "--",
      totalBytes: rootStorage?.totalBytes ?? null,
      usedBytes: rootStorage?.usedBytes ?? null,
      availableBytes: rootStorage?.availableBytes ?? null,
      usedPercent:
        rootStorage && Number.isFinite(rootStorage.usedPercent)
          ? Number(rootStorage.usedPercent.toFixed(1))
          : null,
      summary:
        rootStorage && rootStorage.totalBytes > 0
          ? `${formatBytes(rootStorage.usedBytes)} / ${formatBytes(rootStorage.totalBytes)}`
          : "--",
      shares,
      localShareCount: localFolderShares.length,
      networkShareCount: networkShares.length,
      disks,
      raid: rootStorage?.raid ?? null,
      smart: rootStorage?.smart ?? null,
      isLoading:
        systemMetricsQuery.isLoading ||
        localFolderSharesQuery.isLoading ||
        networkSharesQuery.isLoading,
      unavailable: Boolean(systemMetricsQuery.error),
      warning: warnings.length > 0 ? warnings.join(" ") : null,
    };
  }, [
    localFolderSharesQuery.data,
    localFolderSharesQuery.error,
    localFolderSharesQuery.isLoading,
    networkSharesQuery.data,
    networkSharesQuery.error,
    networkSharesQuery.isLoading,
    systemMetricsQuery.data?.storage,
    systemMetricsQuery.error,
    systemMetricsQuery.isLoading,
  ]);

  const updates = useMemo(() => {
    const data = systemUpdatesQuery.data ?? {
      currentVersion: general.appVersion,
      latestVersion: null,
      updateAvailable: false,
      checkedAt: null,
    };

    return {
      currentVersion: data.currentVersion,
      latestVersion: data.latestVersion,
      updateAvailable: data.updateAvailable,
      checkedAt: data.checkedAt,
      isLoading: systemUpdatesQuery.isLoading,
      unavailable: !isUpdateRecoveryActive && Boolean(systemUpdatesQuery.error),
      warning:
        isUpdateRecoveryActive
          ? null
          : systemUpdatesQuery.error
            ? "Homeio update status unavailable."
            : null,
      isChecking: checkUpdatesMutation.isPending,
      isApplying: applySystemUpdateMutation.isPending,
      checkError:
        !isUpdateRecoveryActive && checkUpdatesMutation.error instanceof Error
          ? checkUpdatesMutation.error.message
          : null,
      applyError:
        !isUpdateRecoveryActive && applySystemUpdateMutation.error instanceof Error
          ? applySystemUpdateMutation.error.message
          : null,
      isRecoveryActive: isUpdateRecoveryActive,
    };
  }, [
    applySystemUpdateMutation.error,
    applySystemUpdateMutation.isPending,
    checkUpdatesMutation.error,
    checkUpdatesMutation.isPending,
    general.appVersion,
    isUpdateRecoveryActive,
    systemUpdatesQuery.data,
    systemUpdatesQuery.error,
    systemUpdatesQuery.isLoading,
  ]);

  const generalPreferences = useMemo(() => {
    const data = systemPreferencesQuery.data ?? {
      hostname: general.hostname,
      timezone: SYSTEM_TIMEZONE_OPTIONS[0],
    };

    return {
      hostname: data.hostname,
      timezone: data.timezone,
      isLoading: systemPreferencesQuery.isLoading,
      isSaving: systemPreferencesMutation.isPending,
      error:
        systemPreferencesMutation.error instanceof Error
          ? systemPreferencesMutation.error.message
          : systemPreferencesQuery.error instanceof Error
            ? systemPreferencesQuery.error.message
            : null,
      timezoneOptions:
        data.timezone &&
        !SYSTEM_TIMEZONE_OPTIONS.some((option) => option === data.timezone)
        ? [data.timezone, ...SYSTEM_TIMEZONE_OPTIONS]
        : [...SYSTEM_TIMEZONE_OPTIONS],
    };
  }, [
    general.hostname,
    systemPreferencesMutation.error,
    systemPreferencesMutation.isPending,
    systemPreferencesQuery.data,
    systemPreferencesQuery.error,
    systemPreferencesQuery.isLoading,
  ]);

  const backup = useMemo(() => {
    const snapshot = backupsQuery.data;
    const settings = snapshot?.settings ?? {
      enabled: false,
      frequency: "weekly" as const,
      dayOfWeek: "sunday" as const,
      time: "03:00",
      retentionCount: 7,
    };

    return {
      settings: {
        ...settings,
        isLoading: backupsQuery.isLoading,
        isSaving: backupSettingsMutation.isPending,
        error:
          backupSettingsMutation.error instanceof Error
            ? backupSettingsMutation.error.message
            : backupsQuery.error instanceof Error
              ? backupsQuery.error.message
              : null,
      },
      backups: snapshot?.backups ?? [],
      backupRoot: snapshot?.backupRoot ?? DEFAULT_BACKUP_ROOT,
      isLoading: backupsQuery.isLoading,
      runNow: {
        isPending: backupRunMutation.isPending,
        error:
          backupRunMutation.error instanceof Error
            ? backupRunMutation.error.message
            : null,
      },
      restore: {
        isPending: restoreBackupMutation.isPending,
        error:
          restoreBackupMutation.error instanceof Error
            ? restoreBackupMutation.error.message
            : null,
      },
    };
  }, [
    backupsQuery.data,
    backupsQuery.error,
    backupsQuery.isLoading,
    backupRunMutation.error,
    backupRunMutation.isPending,
    backupSettingsMutation.error,
    backupSettingsMutation.isPending,
    restoreBackupMutation.error,
    restoreBackupMutation.isPending,
  ]);

  const security = useMemo(() => {
    const data = systemSecurityQuery.data ?? {
      firewallEnabled: false,
      firewallIncomingPolicy: "deny" as const,
      firewallOutgoingPolicy: "allow" as const,
      fail2banEnabled: false,
      fail2banMaxRetries: 5,
      fail2banBanDurationSeconds: 3600,
    };

    return {
      firewall: {
        enabled: data.firewallEnabled,
        incomingPolicy: data.firewallIncomingPolicy,
        outgoingPolicy: data.firewallOutgoingPolicy,
        policyOptions: [...SYSTEM_SECURITY_POLICY_OPTIONS],
      },
      fail2ban: {
        enabled: data.fail2banEnabled,
        maxRetries: data.fail2banMaxRetries,
        banDuration: data.fail2banBanDurationSeconds,
        maxRetriesBounds: {
          min: SYSTEM_SECURITY_MAX_RETRIES_MIN,
          max: SYSTEM_SECURITY_MAX_RETRIES_MAX,
        },
        banDurationBounds: {
          min: SYSTEM_SECURITY_BAN_DURATION_MIN,
          max: SYSTEM_SECURITY_BAN_DURATION_MAX,
        },
      },
      isLoading: systemSecurityQuery.isLoading,
      isSaving: systemSecurityMutation.isPending,
      unavailable: Boolean(systemSecurityQuery.error),
      error:
        systemSecurityMutation.error instanceof Error
          ? systemSecurityMutation.error.message
          : systemSecurityQuery.error instanceof Error
            ? systemSecurityQuery.error.message
            : null,
    };
  }, [
    systemSecurityMutation.error,
    systemSecurityMutation.isPending,
    systemSecurityQuery.data,
    systemSecurityQuery.error,
    systemSecurityQuery.isLoading,
  ]);

  const power = useMemo(() => {
    const scheduledReboot: ScheduledRebootConfig =
      scheduledRebootQuery.data ?? DEFAULT_SCHEDULED_REBOOT_CONFIG;
    const caps = powerCapabilitiesQuery.data;

    return {
      reboot: {
        available: caps?.reboot ?? false,
        isPending: rebootMutation.isPending,
        error:
          rebootMutation.error instanceof Error
            ? rebootMutation.error.message
            : null,
      },
      shutdown: {
        available: caps?.shutdown ?? false,
        isPending: shutdownMutation.isPending,
        error:
          shutdownMutation.error instanceof Error
            ? shutdownMutation.error.message
            : null,
      },
      factoryReset: {
        available: caps?.factoryReset ?? false,
        isPending: factoryResetMutation.isPending,
        error:
          factoryResetMutation.error instanceof Error
            ? factoryResetMutation.error.message
            : null,
      },
      scheduledReboot: {
        ...scheduledReboot,
        available: caps?.scheduledReboot ?? false,
        isLoading: scheduledRebootQuery.isLoading,
        isPending: scheduledRebootMutation.isPending,
        error:
          scheduledRebootMutation.error instanceof Error
            ? scheduledRebootMutation.error.message
            : scheduledRebootQuery.error instanceof Error
              ? scheduledRebootQuery.error.message
              : null,
      },
    };
  }, [
    factoryResetMutation.error,
    factoryResetMutation.isPending,
    powerCapabilitiesQuery.data,
    rebootMutation.error,
    rebootMutation.isPending,
    scheduledRebootMutation.error,
    scheduledRebootMutation.isPending,
    scheduledRebootQuery.data,
    scheduledRebootQuery.error,
    scheduledRebootQuery.isLoading,
    shutdownMutation.error,
    shutdownMutation.isPending,
  ]);

  const capabilities = useMemo(() => createSettingsCapabilities(), []);

  return {
    general,
    generalPreferences,
    network,
    storage,
    docker,
    security,
    backup,
    updates,
    power,
    capabilities,
    actions: {
      checkForUpdates,
      applySystemUpdate: async () => {
        if (isUpdateRecoveryActive || applySystemUpdateMutation.isPending) return;

        try {
          await applySystemUpdateMutation.mutateAsync(undefined);
        } catch {
          return;
        }

        setIsUpdateRecoveryActive(true);
        persistPowerActionState("update", {
          requestDispatchedAt: new Date().toISOString(),
        });
        window.location.replace("/updating");
      },
      saveGeneralPreferences: async (input: SystemPreferences) => {
        await systemPreferencesMutation.mutateAsync(input);
      },
      saveSecuritySettings: async (input: SystemSecuritySettings) => {
        await systemSecurityMutation.mutateAsync(input);
      },
      saveBackupSettings: async (input: SystemBackupSettings) => {
        await backupSettingsMutation.mutateAsync(input);
      },
      runBackupNow: async () => {
        await backupRunMutation.mutateAsync(undefined);
      },
      restoreBackup: async (backupId: string) => {
        // Replaces everything on the machine with the archive's contents, so
        // the server asks for the password again; this turns that into a
        // prompt rather than an error the user cannot act on.
        await runElevated(() => restoreBackupMutation.mutateAsync(backupId));
      },
      rebootNow: async () => {
        await rebootMutation.mutateAsync(undefined);
      },
      shutdownNow: async () => {
        await shutdownMutation.mutateAsync(undefined);
      },
      saveScheduledReboot: async (input: ScheduledRebootConfig) => {
        await scheduledRebootMutation.mutateAsync(input);
      },
      pruneDockerImages: async () => {
        await pruneImagesMutation.mutateAsync(undefined);
      },
      pruneDockerVolumes: async () => {
        await pruneVolumesMutation.mutateAsync(undefined);
      },
      factoryReset: async () => {
        await runElevated(() => factoryResetMutation.mutateAsync(undefined));
      },
    },
  };
}
