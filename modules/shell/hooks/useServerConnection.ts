"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { reloadBrowserWindow } from "@/lib/desktop/browser-reload";
import { readPersistedPowerActionState } from "@/lib/desktop/reboot-state";
import {
  SYSTEM_STREAM_STATUS_EVENT,
  type SystemStreamStatus,
} from "@/lib/desktop/system-stream-status";
import type { SystemMetricsSnapshot } from "@/lib/shared/contracts/system";
import { queryKeys } from "@/lib/shared/query-keys";

export type ServerConnectionPhase = "online" | "lost" | "restored";

export type ServerRuntime = "docker" | "host" | null;

// The screen shows on the first failed check. It only runs once the stream
// has dropped (or the browser went offline), so that is already a second
// signal: a restart that keeps Homeio away for a second or two still shows
// "Reconnecting" and then "back", instead of nothing at all.
const FAST_RETRY_MS = 2_000;
const SLOW_RETRY_MS = 5_000;
const FAST_RETRY_WINDOW_MS = 60_000;
const HEALTH_TIMEOUT_MS = 5_000;
const RESTORED_HOLD_MS = 1_200;
// Clocks and uptime are both the server's, but sampling adds a little jitter.
const RESTART_TOLERANCE_MS = 10_000;

type ProcessIdentity = { pid: number; startedAtMs: number };

function identify(snapshot: SystemMetricsSnapshot | undefined): ProcessIdentity | null {
  if (!snapshot?.process) return null;
  const sampledAtMs = Date.parse(snapshot.timestamp);
  if (!Number.isFinite(sampledAtMs)) return null;
  return {
    pid: snapshot.process.pid,
    startedAtMs: sampledAtMs - snapshot.process.uptimeSeconds * 1_000,
  };
}

function isSameProcess(before: ProcessIdentity | null, after: ProcessIdentity | null) {
  if (!before || !after) return false;
  return (
    before.pid === after.pid &&
    Math.abs(before.startedAtMs - after.startedAtMs) < RESTART_TOLERANCE_MS
  );
}

async function isHealthy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMetricsSnapshot(): Promise<SystemMetricsSnapshot | undefined> {
  try {
    const response = await fetch("/api/v1/system/metrics", { cache: "no-store" });
    if (!response.ok) return undefined;
    const json = (await response.json()) as { data?: SystemMetricsSnapshot };
    return json.data;
  } catch {
    return undefined;
  }
}

// Fetch the logo while the server still answers: once it is gone, /icon.png
// is gone with it.
function usePreloadedLogo() {
  const [logoSrc, setLogoSrc] = useState("/icon.png");

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    fetch("/icon.png")
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLogoSrc(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  return logoSrc;
}

/**
 * Notices when Homeio stops answering without warning (a crash, a restart
 * from the terminal, a dropped network) and follows it until it is back.
 * Reboots and updates started from the desktop have their own screen.
 */
export function useServerConnection(enabled: boolean) {
  const queryClient = useQueryClient();
  const logoSrc = usePreloadedLogo();
  const [phase, setPhase] = useState<ServerConnectionPhase>("online");
  const [isBrowserOffline, setIsBrowserOffline] = useState(false);
  const [lostSince, setLostSince] = useState<number | null>(null);
  const [serverRestarted, setServerRestarted] = useState(false);
  const [runtime, setRuntime] = useState<ServerRuntime>(null);

  const probingRef = useRef(false);
  const inFlightRef = useRef(false);
  const phaseRef = useRef<ServerConnectionPhase>("online");
  const firstFailureAtRef = useRef<number | null>(null);
  const identityBeforeRef = useRef<ProcessIdentity | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const updatePhase = useCallback((next: ServerConnectionPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    probingRef.current = false;
    firstFailureAtRef.current = null;
    setLostSince(null);
    setServerRestarted(false);
    updatePhase("online");
  }, [clearTimer, updatePhase]);

  // Resolves false when the server dropped again before it could be read.
  const recover = useCallback(async () => {
    const authResponse = await fetch("/api/auth/me", { cache: "no-store" }).catch(() => null);
    if (!authResponse || authResponse.status >= 500) return false;
    const identityAfter = identify(await fetchMetricsSnapshot());
    // A new process may carry a new build, and a signed-out session needs the
    // login page: in both cases only a reload gets the desktop right.
    const needsReload =
      authResponse?.status === 401 ||
      !isSameProcess(identityBeforeRef.current, identityAfter);

    setServerRestarted(needsReload);
    updatePhase("restored");

    timerRef.current = setTimeout(() => {
      if (needsReload) {
        reloadBrowserWindow();
        return;
      }
      void queryClient.invalidateQueries();
      reset();
    }, RESTORED_HOLD_MS);
    return true;
  }, [queryClient, reset, updatePhase]);

  const probe = useCallback(async function run() {
    if (inFlightRef.current) return;
    clearTimer();
    if (!enabledRef.current || phaseRef.current === "restored") return;
    if (readPersistedPowerActionState(window.localStorage)) {
      reset();
      return;
    }

    probingRef.current = true;
    inFlightRef.current = true;
    let healthy = await isHealthy();
    if (healthy && phaseRef.current === "lost" && enabledRef.current) {
      healthy = await recover();
    }
    inFlightRef.current = false;
    if (!enabledRef.current) return;

    if (healthy) {
      if (phaseRef.current === "online") reset();
      return;
    }

    const now = Date.now();
    firstFailureAtRef.current ??= now;

    if (phaseRef.current === "online") {
      const snapshot = queryClient.getQueryData<SystemMetricsSnapshot>(queryKeys.systemMetrics);
      identityBeforeRef.current = identify(snapshot);
      setRuntime(snapshot?.process?.runtime ?? null);
      setLostSince(firstFailureAtRef.current);
      updatePhase("lost");
    }

    const delay =
      now - firstFailureAtRef.current < FAST_RETRY_WINDOW_MS ? FAST_RETRY_MS : SLOW_RETRY_MS;
    timerRef.current = setTimeout(() => void run(), delay);
  }, [clearTimer, queryClient, recover, reset, updatePhase]);

  const startProbing = useCallback(() => {
    if (probingRef.current) return;
    void probe();
  }, [probe]);

  const checkNow = useCallback(() => {
    if (phaseRef.current !== "lost") return;
    void probe();
  }, [probe]);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }

    setIsBrowserOffline(!navigator.onLine);
    if (!navigator.onLine) startProbing();

    const onStreamStatus = (event: Event) => {
      const status = (event as CustomEvent<SystemStreamStatus>).detail;
      if (status === "disconnected") {
        startProbing();
      } else if (phaseRef.current === "lost") {
        void probe();
      }
    };
    const onOffline = () => {
      setIsBrowserOffline(true);
      startProbing();
    };
    const onOnline = () => {
      setIsBrowserOffline(false);
      if (phaseRef.current === "lost") void probe();
    };

    window.addEventListener(SYSTEM_STREAM_STATUS_EVENT, onStreamStatus);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener(SYSTEM_STREAM_STATUS_EVENT, onStreamStatus);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      clearTimer();
      probingRef.current = false;
    };
  }, [clearTimer, enabled, probe, reset, startProbing]);

  return {
    phase,
    isBrowserOffline,
    lostSince,
    serverRestarted,
    runtime,
    logoSrc,
    checkNow,
  };
}
