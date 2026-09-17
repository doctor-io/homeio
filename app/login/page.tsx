import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { AuthCard } from "@/modules/shell/components/auth-card";
import { FullScreenShell } from "@/modules/shell/components/full-screen-shell";
import { readAppearanceSettings } from "@/lib/server/modules/settings/appearance-repository";

// Read DEMO_MODE at request time, not build time — without this Next.js
// prerenders the page once and the demo banner stays hidden even after the
// operator flips DEMO_MODE=true and restarts the service.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const isDemoMode = process.env.DEMO_MODE === "true";
  // Read here rather than letting FullScreenShell fetch it: the client hook
  // goes to /api/v1/settings/appearance, which needs a session nobody has on
  // the login page, so the fetch 401s and the shell falls back to the default
  // wallpaper. Whatever the operator picked never showed on the way in.
  const { wallpaper } = await readAppearanceSettings();

  return (
    <FullScreenShell
      wallpaper={wallpaper}
      center={
        <AuthCard>
          <Suspense fallback={null}>
            <LoginForm isDemoMode={isDemoMode} />
          </Suspense>
        </AuthCard>
      }
    />
  );
}
