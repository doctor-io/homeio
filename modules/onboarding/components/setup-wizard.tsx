"use client";

import { useState } from "react";
import type { OnboardingState } from "@/lib/shared/contracts/onboarding";

type SetupWizardProps = {
  initialState: OnboardingState;
};

/**
 * Wizard shell. W3 ships the frame and the escape hatch only — the five steps
 * land in W4/W5/W6/W7. Skipping must always be possible: an install that skips
 * every step has to end up exactly where 1.7.24 leaves it.
 */
export function SetupWizard({ initialState }: SetupWizardProps) {
  const [isFinishing, setIsFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setIsFinishing(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/setup/complete", { method: "POST" });
      if (!response.ok) throw new Error(`Setup completion failed (${response.status})`);

      // Full reload rather than a client transition: the desktop shell boots
      // its realtime streams on mount and should start from a clean slate.
      window.location.assign("/");
    } catch {
      setError("Could not finish setup. Check the server and try again.");
      setIsFinishing(false);
    }
  }

  return (
    <div className="w-full text-center" data-testid="setup-wizard">
      <p className="text-[1.48rem] font-medium tracking-[-0.03em] text-foreground">
        Set up your server
      </p>
      <p className="mb-5 mt-1 text-[11px] tracking-[0.18em] text-muted-foreground/78 uppercase">
        Step {initialState.step} of 5
      </p>

      <p className="mx-auto mb-7 max-w-[22rem] text-[12px] leading-relaxed text-muted-foreground/72">
        A few questions to get your time zone, storage, remote access, and first app in
        place. You can skip any of it and change everything later in Settings.
      </p>

      {error && (
        <p className="system-error-capsule mx-auto mb-4 text-[12px]" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={finish}
        disabled={isFinishing}
        className="system-primary-action inline-flex cursor-pointer items-center gap-2 rounded-full px-8 py-2.5 text-sm font-medium transition-all hover:brightness-110 disabled:opacity-60"
      >
        {isFinishing ? "Finishing…" : "Skip setup"}
      </button>

      <p className="mt-3 text-[11px] text-muted-foreground/60">
        Everything here is optional.
      </p>
    </div>
  );
}
