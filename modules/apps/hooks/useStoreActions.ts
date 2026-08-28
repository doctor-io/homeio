"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreOperation, StoreOperationAction, StoreOperationEvent } from "@/lib/shared/contracts/apps";
import { queryKeys } from "@/lib/shared/query-keys";
import {
  fetchStoreOperationSnapshot,
  subscribeToStoreOperationEvents,
} from "@/modules/apps/hooks/useStoreOperation";

type StartOperationResponse = {
  operationId: string;
};

type StartCustomOperationResponse = {
  appId: string;
  operationId: string;
};

type AppOperationState = {
  operationId: string;
  appId: string;
  action: StoreOperationAction;
  status: StoreOperation["status"];
  progressPercent: number;
  step: string;
  message: string | null;
};

type StartActionResult = {
  appId: string;
  operationId: string;
  action: StoreOperationAction;
};

type InstallAppInput = {
  appId: string;
  displayName?: string;
  env?: Record<string, string>;
  webUiPort?: number;
  composeSource?: string;
  resetToCatalog?: boolean;
};

type InstallCustomAppInput = {
  name: string;
  iconUrl?: string;
  repositoryUrl?: string;
  sourceType: "docker-compose" | "docker-run";
  source: string;
  /** Set once the user has seen the host access the file asks for. */
  acknowledgeRisks?: boolean;
};

type ImportCustomAppInput = {
  url: string;
  name?: string;
  ref?: string;
  acknowledgeRisks?: boolean;
};

export type ComposeRiskDetail = {
  code: string;
  service: string;
  detail: string;
};

/**
 * Thrown when the server refuses an install until its risks are acknowledged.
 * Carries the list so the caller can show exactly what was asked for instead
 * of a flattened message.
 */
export class ComposeRisksError extends Error {
  readonly risks: ComposeRiskDetail[];

  constructor(message: string, risks: ComposeRiskDetail[]) {
    super(message);
    this.name = "ComposeRisksError";
    this.risks = risks;
  }
}

function riskErrorFrom(payload: ErrorResponsePayload | null) {
  const risks = (payload as { risks?: ComposeRiskDetail[] } | null)?.risks;
  if (!Array.isArray(risks) || risks.length === 0) return null;
  return new ComposeRisksError(
    payload?.error?.trim() || "This compose file asks for privileged access",
    risks,
  );
}

type SaveAppSettingsInput = {
  appId: string;
  displayName?: string;
  iconUrl?: string | null;
  env?: Record<string, string>;
  webUiPort?: number;
  composeSource?: string;
};

type StoreActionsHandle = {
  operationsByApp: Record<string, AppOperationState>;
  installApp: (input: InstallAppInput) => Promise<unknown>;
  installCustomApp: (input: InstallCustomAppInput) => Promise<unknown>;
  importCustomApp: (input: ImportCustomAppInput) => Promise<unknown>;
  updateApp: (input: { appId: string }) => Promise<unknown>;
  redeployApp: (input: {
    appId: string;
    env?: Record<string, string>;
    webUiPort?: number;
    composeSource?: string;
  }) => Promise<unknown>;
  uninstallApp: (input: { appId: string; removeVolumes?: boolean }) => Promise<unknown>;
  saveAppSettings: (input: SaveAppSettingsInput) => Promise<unknown>;
  startApp: (appId: string) => Promise<unknown>;
  stopApp: (appId: string) => Promise<unknown>;
  restartApp: (appId: string) => Promise<unknown>;
  checkAppUpdates: (appId: string) => Promise<unknown>;
};

type ErrorResponsePayload = {
  error?: string;
  code?: string;
};

const OPERATION_SNAPSHOT_POLL_MS = 1_500;
const MISSING_OPERATION_SNAPSHOT_LIMIT = 3;
// How long to keep a successful operation in state after it completes,
// so queries have time to refetch before the "Install" button reappears.
const OPERATION_SUCCESS_LINGER_MS = 2_500;
// How long to keep a failed operation visible before auto-clearing.
const OPERATION_ERROR_LINGER_MS = 8_000;

function isTerminalStatus(status: StoreOperation["status"]) {
  return status === "success" || status === "error";
}

function mapOperationToState(operation: StoreOperation): AppOperationState {
  return {
    operationId: operation.id,
    appId: operation.appId,
    action: operation.action,
    status: operation.status,
    progressPercent: operation.progressPercent,
    step: operation.currentStep,
    message: operation.errorMessage,
  };
}

function mapEventToState(event: StoreOperationEvent): AppOperationState {
  return {
    operationId: event.operationId,
    appId: event.appId,
    action: event.action,
    status: event.status,
    progressPercent: event.progressPercent,
    step: event.step,
    message: event.message ?? null,
  };
}

function toStoreActionErrorMessage(
  endpoint: string,
  status: number,
  payload: ErrorResponsePayload | null,
) {
  const baseMessage = payload?.error?.trim() || `Failed request (${status}) for ${endpoint}`;
  const code = payload?.code?.trim();
  if (!code) return baseMessage;
  return `${baseMessage} [${code}]`;
}

async function parseErrorPayload(response: Response) {
  try {
    return (await response.json()) as ErrorResponsePayload;
  } catch {
    return null;
  }
}

async function startLifecycleRequest(
  endpoint: string,
  payload: Record<string, unknown>,
  action: string,
) {
  void action;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = await parseErrorPayload(response);
    throw new Error(
      toStoreActionErrorMessage(endpoint, response.status, errorPayload),
    );
  }

  return (await response.json()) as StartOperationResponse;
}

export function useStoreActions(): StoreActionsHandle {
  const queryClient = useQueryClient();
  const [operationsByApp, setOperationsByApp] = useState<Record<string, AppOperationState>>({});
  const streamCleanups = useRef<Map<string, () => void>>(new Map());
  const pollCleanups = useRef<Map<string, () => void>>(new Map());

  const clearTrackedOperation = useCallback((appId: string, operationId: string) => {
    setOperationsByApp((previous) => {
      const current = previous[appId];
      if (!current || current.operationId !== operationId) {
        return previous;
      }

      const next = { ...previous };
      delete next[appId];
      return next;
    });
  }, []);

  useEffect(() => {
    const activeStreams = streamCleanups.current;
    const activePolls = pollCleanups.current;

    return () => {
      for (const cleanup of activeStreams.values()) {
        cleanup();
      }
      activeStreams.clear();

      for (const cleanup of activePolls.values()) {
        cleanup();
      }
      activePolls.clear();
    };
  }, []);

  const attachOperationTracking = useCallback(
    async ({ appId, operationId, action }: StartActionResult) => {
      const existingStreamCleanup = streamCleanups.current.get(operationId);
      if (existingStreamCleanup) {
        existingStreamCleanup();
        streamCleanups.current.delete(operationId);
      }

      const existingPollCleanup = pollCleanups.current.get(operationId);
      if (existingPollCleanup) {
        existingPollCleanup();
        pollCleanups.current.delete(operationId);
      }

      setOperationsByApp((previous) => ({
        ...previous,
        [appId]: {
          operationId,
          appId,
          action,
          status: "queued",
          progressPercent: 0,
          step: "queued",
          message: null,
        },
      }));

      let streamCleanup: (() => void) | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      let missingSnapshotCount = 0;

      const clearPollTimer = () => {
        if (pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
      };

      const stopTracking = () => {
        if (stopped) return;
        stopped = true;

        clearPollTimer();
        pollCleanups.current.delete(operationId);

        if (streamCleanup) {
          streamCleanup();
          streamCleanup = null;
        }
        streamCleanups.current.delete(operationId);
      };

      const invalidateTerminalState = (terminalAppId: string, terminalOperationId: string) => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.storeCatalog }),
          queryClient.invalidateQueries({ queryKey: queryKeys.installedApps }),
          queryClient.invalidateQueries({ queryKey: queryKeys.storeApp(terminalAppId) }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.appCompose(terminalAppId, "installed"),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.appCompose(terminalAppId, "catalog"),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.storeOperation(terminalOperationId),
          }),
        ]);
      };

      const applySnapshotState = (snapshot: StoreOperation) => {
        if (stopped) return;
        missingSnapshotCount = 0;

        const nextState = mapOperationToState(snapshot);

        setOperationsByApp((previous) => ({
          ...previous,
          [snapshot.appId]: nextState,
        }));

        queryClient.setQueryData(queryKeys.storeOperation(snapshot.id), snapshot);

        if (isTerminalStatus(snapshot.status)) {
          stopTracking();
          invalidateTerminalState(snapshot.appId, snapshot.id);
          const lingerMs = snapshot.status === "success"
            ? OPERATION_SUCCESS_LINGER_MS
            : OPERATION_ERROR_LINGER_MS;
          setTimeout(() => {
            clearTrackedOperation(snapshot.appId, snapshot.id);
          }, lingerMs);
        }
      };

      const scheduleSnapshotPoll = () => {
        if (stopped) return;
        clearPollTimer();
        pollTimer = setTimeout(() => {
          void syncSnapshot();
        }, OPERATION_SNAPSHOT_POLL_MS);
      };

      const syncSnapshot = async () => {
        if (stopped) return;

        try {
          const snapshot = await fetchStoreOperationSnapshot(operationId);
          if (snapshot) {
            applySnapshotState(snapshot);
          } else {
            missingSnapshotCount += 1;

            if (missingSnapshotCount >= MISSING_OPERATION_SNAPSHOT_LIMIT) {
              stopTracking();
              void Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.storeCatalog }),
                queryClient.invalidateQueries({ queryKey: queryKeys.installedApps }),
                queryClient.invalidateQueries({ queryKey: queryKeys.storeApp(appId) }),
              ]);
              setTimeout(() => {
                clearTrackedOperation(appId, operationId);
              }, OPERATION_SUCCESS_LINGER_MS);
            }
          }
        } catch {
          // Keep stream active; we'll retry on next poll.
        } finally {
          if (!stopped) {
            scheduleSnapshotPoll();
          }
        }
      };

      pollCleanups.current.set(operationId, () => {
        clearPollTimer();
      });

      try {
        await syncSnapshot();
      } catch {
        // Keep optimistic queued state and continue with SSE subscription.
      }

      if (stopped) {
        return;
      }

      streamCleanup = subscribeToStoreOperationEvents(operationId, {
        onEvent: (event) => {
          if (stopped) return;

          setOperationsByApp((previous) => ({
            ...previous,
            [event.appId]: mapEventToState(event),
          }));

          queryClient.setQueryData(
            queryKeys.storeOperation(event.operationId),
            (previous: StoreOperation | null | undefined) =>
              previous
                ? {
                    ...previous,
                    status: event.status,
                    progressPercent: event.progressPercent,
                    currentStep: event.step,
                    errorMessage: event.status === "error" ? (event.message ?? "Operation failed") : null,
                    updatedAt: event.timestamp,
                  }
                : null,
          );

          if (isTerminalStatus(event.status)) {
            stopTracking();
            invalidateTerminalState(event.appId, event.operationId);
            const lingerMs = event.status === "success"
              ? OPERATION_SUCCESS_LINGER_MS
              : OPERATION_ERROR_LINGER_MS;
            setTimeout(() => {
              clearTrackedOperation(event.appId, event.operationId);
            }, lingerMs);
          }
        },
        onError: () => {
          if (stopped) return;
          void syncSnapshot();
        },
      });

      streamCleanups.current.set(operationId, () => {
        stopTracking();
      });
    },
    [clearTrackedOperation, queryClient],
  );

  const installMutation = useMutation({
    mutationFn: async (input: InstallAppInput) => {
      const response = await startLifecycleRequest(
        `/api/v1/store/apps/${encodeURIComponent(input.appId)}/install`,
        {
          displayName: input.displayName,
          env: input.env,
          webUiPort: input.webUiPort,
          composeSource: input.composeSource,
          resetToCatalog: input.resetToCatalog,
        },
        "hooks.useStoreActions.install",
      );

      return {
        appId: input.appId,
        operationId: response.operationId,
        action: "install" as const,
      };
    },
    onSuccess: ({ appId, operationId, action }) => {
      void attachOperationTracking({
        appId,
        operationId,
        action,
      });
    },
  });

  const redeployMutation = useMutation({
    mutationFn: async (input: {
      appId: string;
      env?: Record<string, string>;
      webUiPort?: number;
      composeSource?: string;
    }) => {
      const response = await startLifecycleRequest(
        `/api/v1/store/apps/${encodeURIComponent(input.appId)}/redeploy`,
        {
          env: input.env,
          webUiPort: input.webUiPort,
          composeSource: input.composeSource,
        },
        "hooks.useStoreActions.redeploy",
      );

      return {
        appId: input.appId,
        operationId: response.operationId,
        action: "redeploy" as const,
      };
    },
    onSuccess: ({ appId, operationId, action }) => {
      void attachOperationTracking({
        appId,
        operationId,
        action,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: {
      appId: string;
    }) => {
      const response = await startLifecycleRequest(
        `/api/v1/store/apps/${encodeURIComponent(input.appId)}/update`,
        {},
        "hooks.useStoreActions.update",
      );

      return {
        appId: input.appId,
        operationId: response.operationId,
        action: "update" as const,
      };
    },
    onSuccess: ({ appId, operationId, action }) => {
      void attachOperationTracking({
        appId,
        operationId,
        action,
      });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (input: {
      appId: string;
      removeVolumes?: boolean;
    }) => {
      const response = await startLifecycleRequest(
        `/api/v1/store/apps/${encodeURIComponent(input.appId)}/uninstall`,
        {
          removeVolumes: input.removeVolumes,
        },
        "hooks.useStoreActions.uninstall",
      );

      return {
        appId: input.appId,
        operationId: response.operationId,
        action: "uninstall" as const,
      };
    },
    onSuccess: ({ appId, operationId, action }) => {
      void attachOperationTracking({
        appId,
        operationId,
        action,
      });
    },
  });

  const importCustomMutation = useMutation({
    mutationFn: async (input: ImportCustomAppInput) => {
      const result = await fetch("/api/v1/store/custom-apps/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      if (!result.ok) {
        const errorPayload = await parseErrorPayload(result);
        const riskError = riskErrorFrom(errorPayload);
        if (riskError) throw riskError;

        throw new Error(
          toStoreActionErrorMessage(
            "/api/v1/store/custom-apps/import",
            result.status,
            errorPayload,
          ),
        );
      }

      return (await result.json()) as { data: { appId: string; name: string } };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storeCatalog });
    },
  });

  const installCustomMutation = useMutation({
    mutationFn: async (input: {
      name: string;
      iconUrl?: string;
      repositoryUrl?: string;
      sourceType: "docker-compose" | "docker-run";
      source: string;
      acknowledgeRisks?: boolean;
    }) => {
      const result = await fetch("/api/v1/store/custom-apps/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      if (!result.ok) {
        const errorPayload = await parseErrorPayload(result);
        const riskError = riskErrorFrom(errorPayload);
        if (riskError) throw riskError;

        throw new Error(
          toStoreActionErrorMessage(
            "/api/v1/store/custom-apps/install",
            result.status,
            errorPayload,
          ),
        );
      }

      return (await result.json()) as StartCustomOperationResponse;
    },
    onSuccess: ({ appId, operationId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storeCatalog });
      void queryClient.invalidateQueries({ queryKey: queryKeys.storeApp(appId) });
      void attachOperationTracking({
        appId,
        operationId,
        action: "install",
      });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (input: {
      appId: string;
      displayName?: string;
      iconUrl?: string | null;
      env?: Record<string, string>;
      webUiPort?: number;
      composeSource?: string;
    }) => {
      const result = await fetch(
        `/api/v1/store/apps/${encodeURIComponent(input.appId)}/settings`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            displayName: input.displayName,
            iconUrl: input.iconUrl,
            env: input.env,
            webUiPort: input.webUiPort,
            composeSource: input.composeSource,
          }),
        },
      );

      if (!result.ok) {
        const errorPayload = await parseErrorPayload(result);
        throw new Error(
          toStoreActionErrorMessage(
            `/api/v1/store/apps/${input.appId}/settings`,
            result.status,
            errorPayload,
          ),
        );
      }

      const response = (await result.json()) as {
        saved: boolean;
        operationId?: string;
      };

      return { appId: input.appId, ...response };
    },
    onSuccess: ({ appId, operationId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storeCatalog });
      void queryClient.invalidateQueries({ queryKey: queryKeys.installedApps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.storeApp(appId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.appCompose(appId, "installed"),
      });

      if (operationId) {
        void attachOperationTracking({
          appId,
          operationId,
          action: "redeploy",
        });
      }
    },
  });

  return {
    operationsByApp,
    installApp: installMutation.mutateAsync,
    installCustomApp: installCustomMutation.mutateAsync,
    importCustomApp: importCustomMutation.mutateAsync,
    updateApp: updateMutation.mutateAsync,
    redeployApp: redeployMutation.mutateAsync,
    startApp: async (appId: string) => {
      const response = await startLifecycleRequest(
        `/api/v1/apps/${encodeURIComponent(appId)}/start`,
        {},
        "hooks.useStoreActions.start",
      );
      const payload = {
        appId,
        operationId: response.operationId,
        action: "start" as const,
      };
      await attachOperationTracking(payload);
      return payload;
    },
    stopApp: async (appId: string) => {
      const response = await startLifecycleRequest(
        `/api/v1/apps/${encodeURIComponent(appId)}/stop`,
        {},
        "hooks.useStoreActions.stop",
      );
      const payload = {
        appId,
        operationId: response.operationId,
        action: "stop" as const,
      };
      await attachOperationTracking(payload);
      return payload;
    },
    restartApp: async (appId: string) => {
      const response = await startLifecycleRequest(
        `/api/v1/apps/${encodeURIComponent(appId)}/restart`,
        {},
        "hooks.useStoreActions.restart",
      );
      const payload = {
        appId,
        operationId: response.operationId,
        action: "restart" as const,
      };
      await attachOperationTracking(payload);
      return payload;
    },
    checkAppUpdates: async (appId: string) => {
      const response = await startLifecycleRequest(
        `/api/v1/apps/${encodeURIComponent(appId)}/check-updates`,
        {},
        "hooks.useStoreActions.checkUpdates",
      );
      const payload = {
        appId,
        operationId: response.operationId,
        action: "check-updates" as const,
      };
      await attachOperationTracking(payload);
      return payload;
    },
    uninstallApp: uninstallMutation.mutateAsync,
    saveAppSettings: saveSettingsMutation.mutateAsync,
  };
}

export type { AppOperationState };
export type {
  InstallAppInput,
  ImportCustomAppInput,
  InstallCustomAppInput,
  SaveAppSettingsInput,
  StoreActionsHandle,
};
