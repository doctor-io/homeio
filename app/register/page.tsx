import { RegisterForm } from "@/components/auth/register-form";
import { FullScreenShell } from "@/modules/shell/components/full-screen-shell";

export default function RegisterPage() {
  return (
    <FullScreenShell
      compactOnMobile
      center={
        <div className="w-full max-w-md">
          <RegisterForm />
        </div>
      }
    />
  );
}
