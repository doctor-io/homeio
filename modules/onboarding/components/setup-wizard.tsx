"use client";

import { useCallback, useEffect, useState } from "react";
import { FirstAppStep } from "@/modules/onboarding/components/steps/first-app-step";
import { RemoteAccessStep } from "@/modules/onboarding/components/steps/remote-access-step";
import { StorageStep } from "@/modules/onboarding/components/steps/storage-step";
import { TwoFactorStep } from "@/modules/onboarding/components/steps/two-factor-step";
import { TimezoneStep } from "@/modules/onboarding/components/steps/timezone-step";
import {
  ONBOARDING_FIRST_STEP,
  ONBOARDING_LAST_STEP,
  type OnboardingState,
  type OnboardingStepNumber,
} from "@/lib/shared/contracts/onboarding";

type SetupWizardProps = {
  initialState: OnboardingState;
  /** Injected so tests can observe the handoff without a real navigation. */
  onFinished?: () => void;
};

type StepDefinition = {
  step: OnboardingStepNumber;
  title: string;
  blurb: string;
};

// Copy lives here rather than in each step component so the frame can render a
// step before its content exists. W5-W7 fill in the panels.
const STEPS: StepDefinition[] = [
  {
    step: 1,
    title: "Set your time zone",
    blurb:
      "Scheduled tasks and log timestamps depend on this. Detected from your browser — change it if the server sits elsewhere.",
  },
  {
    step: 2,
    title: "Choose where data lives",
    blurb:
      "App data and the file manager root. Both can be moved later from Settings.",
  },
  {
    step: 3,
    title: "Reach it from anywhere",
    blurb:
      "Tailscale gives your server a private address on every device you own — no port forwarding, no firewall rules.",
  },
  {
    step: 4,
    title: "Add a second factor",
    blurb:
      "Two-factor authentication means a stolen password is not enough on its own.",
  },
  {
    step: 5,
    title: "Install your first app",
    blurb:
      "Pick something to start with — it installs in the background while you finish here.",
  },
];

function clampStep(value: number): OnboardingStepNumber {
  if (value < ONBOARDING_FIRST_STEP) return ONBOARDING_FIRST_STEP;
  if (value > ONBOARDING_LAST_STEP) return ONBOARDING_LAST_STEP;
  return value as OnboardingStepNumber;
}

export function SetupWizard({ initialState, onFinished }: SetupWizardProps) {
  const [step, setStep] = useState<OnboardingStepNumber>(clampStep(initialState.step));
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(initialState.timezone);
  const [storageRoot, setStorageRoot] = useState<string | null>(
    initialState.defaultStorageRoot,
  );
  // What the server actually stored, as opposed to what the step is currently
  // showing. The time zone step seeds itself from the browser on mount, so
  // local state is not evidence that anything was saved.
  const [saved, setSaved] = useState<{
    timezone: string | null;
    defaultStorageRoot: string | null;
  }>({
    timezone: initialState.timezone,
    defaultStorageRoot: initialState.defaultStorageRoot,
  });
  const [isRemotelyReachable, setIsRemotelyReachable] = useState(false);
  const [isTwoFactorOn, setIsTwoFactorOn] = useState(false);
  const [firstApp, setFirstApp] = useState<{ id: string; name: string } | null>(null);
  const [isDone, setIsDone] = useState(false);

  const current = STEPS.find((entry) => entry.step === step) ?? STEPS[0];
  const isFirst = step === ONBOARDING_FIRST_STEP;
  const isLast = step === ONBOARDING_LAST_STEP;

  const goTo = useCallback(
    async (next: OnboardingStepNumber, answer?: Record<string, string | null>) => {
      setIsBusy(true);
      setError(null);

      try {
        const response = await fetch("/api/v1/setup/step", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ step: next, ...answer }),
        });
        if (!response.ok) throw new Error(`Step save failed (${response.status})`);

        if (answer) setSaved((current) => ({ ...current, ...answer }));
        setStep(next);
      } catch {
        // Stay put on failure. Advancing the UI past a step the server did not
        // record would silently lose the answer on resume.
        setError("Could not save that step. Check the server and try again.");
      } finally {
        setIsBusy(false);
      }
    },
    [],
  );

  const finish = useCallback(
    async (installApp = true) => {
      setIsBusy(true);
      setError(null);

      // Kick the install off but do not wait for the pull. A first install can
      // take minutes, and the wizard should never hold the user hostage to it.
      if (installApp && firstApp) {
        void fetch(`/api/v1/store/apps/${encodeURIComponent(firstApp.id)}/install`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }).catch(() => {
          /* the store surfaces its own failures once the desktop opens */
        });
      }

      try {
        const response = await fetch("/api/v1/setup/complete", { method: "POST" });
        if (!response.ok) throw new Error(`Setup completion failed (${response.status})`);

        setIsDone(true);
        setIsBusy(false);
      } catch {
        setError("Could not finish setup. Check the server and try again.");
        setIsBusy(false);
      }
    },
    [firstApp],
  );

  const leave = useCallback(() => {
    // Full load rather than a client transition: the desktop shell opens its
    // realtime streams on mount and should start from a clean slate.
    if (onFinished) onFinished();
    else window.location.assign("/");
  }, [onFinished]);

  // Skipping a step is the same navigation without that step's answer, so a
  // skipped question never quietly writes a value the user did not choose.
  const advance = useCallback(
    (keepAnswer = true) => {
      if (isBusy) return;
      if (isLast) {
        void finish(keepAnswer);
        return;
      }

      // Annotated rather than inferred: a ternary over object literals widens
      // each branch with the other's keys as `undefined`, which does not fit
      // the Record the request builder takes.
      const answer: Record<string, string | null> | undefined = !keepAnswer
        ? undefined
        : step === 1
          ? { timezone }
          : step === 2
            ? { defaultStorageRoot: storageRoot }
            : undefined;

      void goTo(clampStep(step + 1), answer);
    },
    [finish, goTo, isBusy, isLast, step, storageRoot, timezone],
  );

  const back = useCallback(() => {
    if (isBusy || isFirst) return;
    void goTo(clampStep(step - 1));
  }, [goTo, isBusy, isFirst, step]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Never hijack typing: a step's own inputs own their keys.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }

      if (event.key === "Enter") advance();
      else if (event.key === "Escape") advance(false);
      else if (event.key === "ArrowLeft") back();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, back]);

  if (isDone) {
    const summary = [
      { label: "Time zone", value: saved.timezone },
      { label: "Storage", value: saved.defaultStorageRoot },
      { label: "Remote access", value: isRemotelyReachable ? "Connected" : null },
      { label: "Two-factor", value: isTwoFactorOn ? "On" : null },
      { label: "First app", value: firstApp ? `${firstApp.name} · installing` : null },
    ];

    return (
      <div className="w-full text-center" data-testid="setup-summary">
        <p className="text-[1.48rem] font-medium tracking-[-0.03em] text-foreground">
          Your server is ready
        </p>
        <p className="mb-5 mt-1 text-[11px] tracking-[0.18em] text-muted-foreground/78 uppercase">
          Setup complete
        </p>

        <div className="system-soft-surface mb-6 p-2.5 text-left">
          {summary.map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-2 rounded-[var(--system-radius-control)] px-2.5 py-1.5"
            >
              <span className="flex-grow text-[13px] text-foreground/85">{row.label}</span>
              <span
                className={`truncate text-[12px] ${
                  row.value ? "text-foreground/70" : "text-muted-foreground/50"
                }`}
              >
                {/* Skipped is a normal outcome here, not a failure to flag. */}
                {row.value ?? "Skipped"}
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={leave}
          className="system-primary-action w-full cursor-pointer rounded-[var(--system-radius-control)] px-8 py-2.5 text-sm font-medium transition-all hover:brightness-110"
        >
          Open Homeio
        </button>

        <p className="mt-3 text-[11px] text-muted-foreground/60">
          Everything here can be changed later in Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full text-center" data-testid="setup-wizard">
      <div className="mb-8 flex justify-center gap-2" aria-hidden="true">
        {STEPS.map((entry) => (
          <span
            key={entry.step}
            data-testid={`setup-rail-${entry.step}`}
            data-state={
              entry.step === step ? "current" : entry.step < step ? "done" : "upcoming"
            }
            className={`h-[3px] rounded-full transition-all duration-500 ${
              entry.step === step
                ? "w-6 bg-white"
                : entry.step < step
                  ? "w-4 bg-white/35"
                  : "w-4 bg-white/12"
            }`}
          />
        ))}
      </div>

      <p className="text-[1.48rem] font-medium tracking-[-0.03em] text-foreground">
        {current.title}
      </p>
      <p className="mb-5 mt-1 text-[11px] tracking-[0.18em] text-muted-foreground/78 uppercase">
        Step {step} of {ONBOARDING_LAST_STEP}
      </p>
      <p className="mx-auto mb-5 max-w-[22rem] text-[12px] leading-relaxed text-muted-foreground/72">
        {current.blurb}
      </p>

      <div className="mb-6">
        {step === 1 && <TimezoneStep value={timezone} onChange={setTimezone} />}
        {step === 2 && <StorageStep value={storageRoot} onChange={setStorageRoot} />}
        {step === 3 && <RemoteAccessStep onConnectedChange={setIsRemotelyReachable} />}
        {step === 4 && (
          <TwoFactorStep
            isRemotelyReachable={isRemotelyReachable}
            onEnabled={() => setIsTwoFactorOn(true)}
          />
        )}
        {step === 5 && (
          <FirstAppStep selectedAppId={firstApp?.id ?? null} onChange={setFirstApp} />
        )}
      </div>

      {error && (
        <p className="system-error-capsule mx-auto mb-4 text-[12px]" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => advance()}
          disabled={isBusy}
          className="system-primary-action w-full cursor-pointer rounded-[var(--system-radius-control)] px-8 py-2.5 text-sm font-medium transition-all hover:brightness-110 disabled:opacity-60"
        >
          {isLast ? "Finish setup" : "Continue"}
        </button>

        <div className="flex items-center gap-4 text-[11.5px]">
          {!isFirst && (
            <button
              type="button"
              onClick={back}
              disabled={isBusy}
              className="cursor-pointer text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-60"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => advance(false)}
            disabled={isBusy}
            className="cursor-pointer text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-60"
          >
            {isLast ? "Skip and finish" : "Skip this step"}
          </button>
        </div>
      </div>
    </div>
  );
}
