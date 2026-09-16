import type {
  SystemBackupListResponse,
  SystemBackupSettings,
  SystemPreferences,
  SystemRestoreAcceptedResponse,
  SystemSecuritySettings,
  SystemUpdateApplyAcceptedResponse,
  SystemUpdateStatus,
} from "@/lib/shared/contracts/system";
import { DEFAULT_SCHEDULED_REBOOT_CONFIG } from "@/modules/settings/hooks/backend/constants";
import { throwIfElevationRequired } from "@/modules/auth/elevation/elevation-error";
import type {
  BackupRunAcceptedResponse,
  ScheduledRebootConfig,
} from "@/modules/settings/hooks/backend/types";

type ApiErrorPayload = {
  error?: string;
};

type ApiEnvelope<T> = {
  data?: T;
};

type TimedSettingsRequestOptions<T> = {
  endpoint: string;
  errorMessage: string;
  init?: RequestInit;
  readData?: (payload: ApiEnvelope<T>) => T;
};

async function readErrorMessage(response: Response, fallbackMessage: string) {
  // Throws ElevationRequiredError first when that is what came back; a body can
  // only be read once, so the check has to live where the reading happens.
  const payload = (await throwIfElevationRequired(response)) as ApiErrorPayload;
  return payload.error ?? `${fallbackMessage} (${response.status})`;
}

async function requestSettingsData<T>({
  endpoint,
  errorMessage,
  init,
  readData,
}: TimedSettingsRequestOptions<T>): Promise<T> {
  const response = await fetch(endpoint, init);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, errorMessage));
  }

  const payload = (await response.json()) as ApiEnvelope<T>;
  return readData ? readData(payload) : (payload.data as T);
}

export function fetchSystemUpdatesRequest(): Promise<SystemUpdateStatus> {
  return requestSettingsData<SystemUpdateStatus>({
    endpoint: "/api/v1/system/updates",
    errorMessage: "Failed to load Homeio updates",
    init: {
      cache: "no-store",
    },
  });
}

export function checkSystemUpdatesRequest(): Promise<SystemUpdateStatus> {
  return requestSettingsData<SystemUpdateStatus>({
    endpoint: "/api/v1/system/updates/check",
    errorMessage: "Failed to check for Homeio updates",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
  });
}

export function applySystemUpdateRequest(): Promise<SystemUpdateApplyAcceptedResponse> {
  return requestSettingsData<SystemUpdateApplyAcceptedResponse>({
    endpoint: "/api/v1/system/updates/apply",
    errorMessage: "Failed to schedule Homeio update",
    init: {
      method: "POST",
    },
  });
}

export function fetchSystemPreferencesRequest(): Promise<SystemPreferences> {
  return requestSettingsData<SystemPreferences>({
    endpoint: "/api/v1/system/preferences",
    errorMessage: "Failed to load system preferences",
    init: {
      cache: "no-store",
    },
  });
}

export function saveSystemPreferencesRequest(input: SystemPreferences): Promise<SystemPreferences> {
  return requestSettingsData<SystemPreferences>({
    endpoint: "/api/v1/system/preferences",
    errorMessage: "Failed to save system preferences",
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  });
}

export function fetchSystemSecurityRequest(): Promise<SystemSecuritySettings> {
  return requestSettingsData<SystemSecuritySettings>({
    endpoint: "/api/v1/system/security",
    errorMessage: "Failed to load security settings",
    init: {
      cache: "no-store",
    },
  });
}

export function saveSystemSecurityRequest(
  input: SystemSecuritySettings,
): Promise<SystemSecuritySettings> {
  return requestSettingsData<SystemSecuritySettings>({
    endpoint: "/api/v1/system/security",
    errorMessage: "Failed to save security settings",
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  });
}

export function rebootNowRequest(): Promise<unknown> {
  return requestSettingsData<unknown>({
    endpoint: "/api/v1/system/power/reboot",
    errorMessage: "Failed to schedule reboot",
    init: {
      method: "POST",
    },
  });
}

export function shutdownNowRequest(): Promise<unknown> {
  return requestSettingsData<unknown>({
    endpoint: "/api/v1/system/power/shutdown",
    errorMessage: "Failed to schedule shutdown",
    init: {
      method: "POST",
    },
  });
}

export function factoryResetRequest(): Promise<unknown> {
  return requestSettingsData<unknown>({
    endpoint: "/api/v1/system/power/factory-reset",
    errorMessage: "Failed to schedule factory reset",
    init: {
      method: "POST",
    },
  });
}

export type PowerCapabilities = {
  reboot: boolean;
  shutdown: boolean;
  factoryReset: boolean;
  scheduledReboot: boolean;
};

const DEFAULT_POWER_CAPABILITIES: PowerCapabilities = {
  reboot: false,
  shutdown: false,
  factoryReset: false,
  scheduledReboot: false,
};

export function fetchPowerCapabilitiesRequest(): Promise<PowerCapabilities> {
  return requestSettingsData<PowerCapabilities>({
    endpoint: "/api/v1/system/power/capabilities",
    errorMessage: "Failed to load power capabilities",
    init: {
      cache: "no-store",
    },
    readData: (payload) => payload.data ?? DEFAULT_POWER_CAPABILITIES,
  });
}

export function fetchScheduledRebootRequest(): Promise<ScheduledRebootConfig> {
  return requestSettingsData<ScheduledRebootConfig>({
    endpoint: "/api/v1/system/power/schedule",
    errorMessage: "Failed to load scheduled reboot configuration",
    init: {
      cache: "no-store",
    },
    readData: (payload) => payload.data ?? DEFAULT_SCHEDULED_REBOOT_CONFIG,
  });
}

export function saveScheduledRebootRequest(
  input: ScheduledRebootConfig,
): Promise<ScheduledRebootConfig> {
  return requestSettingsData<ScheduledRebootConfig>({
    endpoint: "/api/v1/system/power/schedule",
    errorMessage: "Failed to save scheduled reboot configuration",
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
    readData: (payload) => payload.data ?? input,
  });
}

export function pruneDockerImagesRequest(): Promise<unknown> {
  return requestSettingsData<unknown>({
    endpoint: "/api/v1/docker/prune/images",
    errorMessage: "Failed to prune Docker images",
    init: {
      method: "POST",
    },
  });
}

export function pruneDockerVolumesRequest(): Promise<unknown> {
  return requestSettingsData<unknown>({
    endpoint: "/api/v1/docker/prune/volumes",
    errorMessage: "Failed to prune Docker volumes",
    init: {
      method: "POST",
    },
  });
}

export function fetchSystemBackupsRequest(): Promise<SystemBackupListResponse> {
  return requestSettingsData<SystemBackupListResponse>({
    endpoint: "/api/v1/system/backups",
    errorMessage: "Failed to load backups",
    init: {
      cache: "no-store",
    },
  });
}

export function saveBackupSettingsRequest(
  input: SystemBackupSettings,
): Promise<SystemBackupSettings> {
  return requestSettingsData<SystemBackupSettings>({
    endpoint: "/api/v1/system/backups/settings",
    errorMessage: "Failed to save backup settings",
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  });
}

export function runBackupNowRequest(): Promise<BackupRunAcceptedResponse> {
  return requestSettingsData<BackupRunAcceptedResponse>({
    endpoint: "/api/v1/system/backups/run",
    errorMessage: "Failed to run backup",
    init: {
      method: "POST",
    },
  });
}

export function restoreBackupRequest(backupId: string): Promise<SystemRestoreAcceptedResponse> {
  return requestSettingsData<SystemRestoreAcceptedResponse>({
    endpoint: `/api/v1/system/backups/${backupId}/restore`,
    errorMessage: "Failed to restore backup",
    init: {
      method: "POST",
    },
  });
}
