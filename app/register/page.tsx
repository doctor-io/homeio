import { RegisterForm } from "@/components/auth/register-form";
import { AuthCard } from "@/modules/shell/components/auth-card";
import { FullScreenShell } from "@/modules/shell/components/full-screen-shell";
import { readAppearanceSettings } from "@/lib/server/modules/settings/appearance-repository";

// The wallpaper is read per request, so the page cannot be prerendered.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // Same reason as /login: the client hook's fetch 401s without a session, so
  // the wallpaper has to arrive from the server or it is always the default.
  const { wallpaper } = await readAppearanceSettings();

  return (
    <FullScreenShell
      wallpaper={wallpaper}
      center={
        <AuthCard>
          <RegisterForm />
        </AuthCard>
      }
    />
  );
}
