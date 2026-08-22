import { redirect } from "next/navigation";
import { FullScreenShell } from "@/modules/shell/components/full-screen-shell";
import { SetupWizard } from "@/modules/onboarding/components/setup-wizard";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import { getOnboardingState } from "@/lib/server/modules/onboarding/service";
import { shouldEnterSetup } from "@/lib/shared/contracts/onboarding";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const state = await readState();

  // Reached directly, or after finishing: there is nothing to set up.
  if (!state || !shouldEnterSetup(state.status)) {
    redirect("/");
  }

  return (
    <FullScreenShell
      center={
        <div className="w-full max-w-md">
          <SetupWizard initialState={state} />
        </div>
      }
    />
  );
}

async function readState() {
  try {
    return await getOnboardingState();
  } catch (error) {
    logServerAction({
      level: "warn",
      layer: "api",
      action: "setup.page.read",
      status: "error",
      requestId: createRequestId(),
      message: "Could not read setup state; sending the user to the desktop",
      error,
    });
    return null;
  }
}
