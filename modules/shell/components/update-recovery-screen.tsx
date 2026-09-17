"use client";

import { reloadBrowserWindow } from "@/lib/desktop/browser-reload";
import {
  clearPersistedPowerActionState,
  readPersistedPowerActionState,
  writePersistedPowerActionCompletion,
  writePersistedPowerActionState,
} from "@/lib/desktop/reboot-state";
import { StatusScreen } from "@/modules/shell/components/status-screen";
import { UpdateLogPane } from "@/modules/shell/components/update-log-pane";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const HEALTH_POLL_MS = 2_000;
const STARTING_PHASE_MS = 4_000;

export type UpdateRecoveryPhase = "starting" | "waiting" | "reconnecting" | "failed";

type UpdateRecoveryScreenProps = {
  manageRecovery?: boolean;
  phaseOverride?: Exclude<UpdateRecoveryPhase, "failed">;
};

function getUpdateRecoveryCopy(phase: UpdateRecoveryPhase, fatalError: string | null) {
  if (phase === "failed") {
    return {
      title: "Homeio update could not start",
      body:
        fatalError ??
        "The update request failed before the service restart began. Return to Homeio and try again.",
    };
  }

  if (phase === "reconnecting") {
    return {
      title: "Reconnecting to Homeio...",
      body: "The update completed and Homeio is coming back. This page will refresh automatically when the new build is ready.",
    };
  }

  if (phase === "waiting") {
    return {
      title: "Applying Homeio update...",
      body: "The updater is rebuilding and restarting Homeio now. This page will reconnect automatically when the updated service is available again.",
    };
  }

  return {
    title: "Starting Homeio update...",
    body: "Preparing the updater now. This page will stay in recovery mode until Homeio finishes restarting.",
  };
}

export function UpdateRecoveryScreen({
  manageRecovery = true,
  phaseOverride,
}: UpdateRecoveryScreenProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<UpdateRecoveryPhase>("starting");
  const [fatalError, setFatalError] = useState<string | null>(null);

  const phaseCopy = useMemo(() => {
    return getUpdateRecoveryCopy(phaseOverride ?? phase, fatalError);
  }, [fatalError, phase, phaseOverride]);

  useEffect(() => {
    if (manageRecovery) return;
    setFatalError(null);
    setPhase(phaseOverride ?? "starting");
  }, [manageRecovery, phaseOverride]);

  useEffect(() => {
    if (!manageRecovery) return;
    if (typeof window === "undefined") return;

    const actionState = readPersistedPowerActionState(window.localStorage);
    if (actionState?.action !== "update") {
      router.replace("/");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hasObservedUnavailable = false;

    const scheduleNextCheck = () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void pollRecovery();
      }, HEALTH_POLL_MS);
    };

    const pollRecovery = async () => {
      if (cancelled) return;

      const latestState = readPersistedPowerActionState(window.localStorage);
      if (!latestState || latestState.action !== "update") {
        router.replace("/");
        return;
      }

      if (!latestState.requestDispatchedAt) {
        writePersistedPowerActionState(window.localStorage, {
          ...latestState,
          requestDispatchedAt: latestState.startedAt,
        });
      }

      const startedAtMs = Date.parse(latestState.startedAt);
      const elapsedMs = Number.isFinite(startedAtMs)
        ? Date.now() - startedAtMs
        : STARTING_PHASE_MS;
      setPhase(elapsedMs < STARTING_PHASE_MS ? "starting" : "waiting");

      try {
        const healthResponse = await fetch("/api/health", {
          cache: "no-store",
        });

        if (!healthResponse.ok) {
          hasObservedUnavailable = true;
          scheduleNextCheck();
          return;
        }

        if (!hasObservedUnavailable && elapsedMs < STARTING_PHASE_MS) {
          scheduleNextCheck();
          return;
        }

        setPhase("reconnecting");

        const authResponse = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        if (authResponse.status === 401) {
          clearPersistedPowerActionState(window.localStorage);
          router.replace("/login");
          return;
        }

        if (!authResponse.ok) {
          scheduleNextCheck();
          return;
        }

        writePersistedPowerActionCompletion(window.localStorage, {
          action: "update",
          completedAt: new Date().toISOString(),
        });
        clearPersistedPowerActionState(window.localStorage);
        reloadBrowserWindow();
      } catch {
        hasObservedUnavailable = true;
        scheduleNextCheck();
      }
    };

    void pollRecovery();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [manageRecovery, router]);

  return (
    <StatusScreen
      title={phaseCopy.title}
      body={phaseCopy.body}
      failed={phase === "failed"}
      action={
        phase === "failed" ? (
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="mt-6 inline-flex items-center rounded-[var(--radius)] bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:brightness-110"
          >
            Return to Homeio
          </button>
        ) : null
      }
      // Issue #41: the wait used to be a spinner and a sentence, with no way to
      // tell a slow npm install from a stuck one. The updater's output was
      // already on disk the whole time; it was simply never shown. Not on the
      // failed screen — there the message is the point, and the log ends
      // wherever it stopped, which only muddies it.
      details={<UpdateLogPane enabled={phase !== "failed"} />}
    />
  );
}
