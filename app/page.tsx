import { redirect } from "next/navigation";
import { DesktopShell } from "@/modules/shell/components/desktop-shell";
import { RealtimeBootstrap } from "@/components/providers/realtime-bootstrap";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import { getOnboardingState } from "@/lib/server/modules/onboarding/service";
import { shouldEnterSetup } from "@/lib/shared/contracts/onboarding";

// The setup check reads the database, so this page cannot be prerendered — the
// same trap that hid DEMO_MODE on /login until 1.7.23 made that page dynamic.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (await isSetupPending()) {
    redirect("/setup");
  }

  return (
    <>
      <RealtimeBootstrap />
      <DesktopShell />
    </>
  );
}

async function isSetupPending() {
  try {
    const state = await getOnboardingState();
    return shouldEnterSetup(state.status);
  } catch (error) {
    // A settings read that fails must never lock someone out of their own
    // server. Fall through to the desktop and let them work.
    logServerAction({
      level: "warn",
      layer: "api",
      action: "setup.gate.read",
      status: "error",
      requestId: createRequestId(),
      message: "Could not read setup state; skipping the wizard",
      error,
    });
    return false;
  }
}
