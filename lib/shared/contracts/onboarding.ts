export const ONBOARDING_FIRST_STEP = 1;
export const ONBOARDING_LAST_STEP = 5;

export type OnboardingStepNumber = 1 | 2 | 3 | 4 | 5;

/**
 * `not_applicable` covers every install created before the first-run wizard
 * existed. Those rows carry a NULL `onboarding_state`, so an operator
 * upgrading from 1.7 is never sent through setup.
 */
export type OnboardingStatus = "not_applicable" | "pending" | "complete";

export type OnboardingState = {
  status: OnboardingStatus;
  step: OnboardingStepNumber;
  timezone: string | null;
  defaultStorageRoot: string | null;
  completedAt: string | null;
};

export type OnboardingProgressInput = {
  step: OnboardingStepNumber;
  timezone?: string | null;
  defaultStorageRoot?: string | null;
};

export function isOnboardingStepNumber(value: unknown): value is OnboardingStepNumber {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ONBOARDING_FIRST_STEP &&
    value <= ONBOARDING_LAST_STEP
  );
}

/**
 * The single place that decides whether a user is sent to the wizard. Only an
 * explicitly pending install qualifies: `complete` has been through it, and
 * `not_applicable` predates it. Anything else falls through to the desktop.
 */
export function shouldEnterSetup(status: OnboardingStatus): boolean {
  return status === "pending";
}
