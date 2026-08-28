"use client";

import { useState } from "react";
import type { TwoFactorSetupResponse } from "@/lib/shared/contracts/auth";
import {
  TwoFactorApiError,
  useStartTwoFactorSetup,
  useVerifyTwoFactor,
} from "@/modules/settings/hooks/useTwoFactor";

type TwoFactorStepProps = {
  /** True when the previous step just made this server reachable off-LAN. */
  isRemotelyReachable?: boolean;
  onEnabled?: () => void;
};

type Phase = "idle" | "enrolling" | "saved";

const ERROR_TEXT: Record<string, string> = {
  invalid_totp: "That code did not match. Check the app and try the next one.",
  already_enabled: "Two-factor is already enabled on this account.",
  no_pending_enrollment: "Start the setup again — the previous attempt expired.",
  too_many_attempts: "Too many attempts. Wait a minute, then try again.",
};

function messageFor(error: unknown): string {
  if (error instanceof TwoFactorApiError) {
    return ERROR_TEXT[error.code] ?? error.message;
  }
  return "Something went wrong. Try again.";
}

export function TwoFactorStep({ isRemotelyReachable, onEnabled }: TwoFactorStepProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [enrollment, setEnrollment] = useState<TwoFactorSetupResponse | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The API calls live in the settings hooks: one implementation of enrolment,
  // two presentations of it.
  const startSetup = useStartTwoFactorSetup();
  const verify = useVerifyTwoFactor();

  async function begin() {
    setError(null);
    try {
      const result = await startSetup.mutateAsync();
      setEnrollment(result);
      setPhase("enrolling");
    } catch (err) {
      setError(messageFor(err));
    }
  }

  async function confirm() {
    setError(null);
    try {
      const result = await verify.mutateAsync({ code });
      setBackupCodes(result.backupCodes);
      setPhase("saved");
      onEnabled?.();
    } catch (err) {
      setError(messageFor(err));
      setCode("");
    }
  }

  return (
    <div className="system-soft-surface p-2.5 text-left">
      {phase === "idle" && (
        <>
          {isRemotelyReachable && (
            <p className="mb-2 rounded-[var(--system-radius-control)] border border-status-amber/20 bg-status-amber/10 px-2.5 py-2 text-[11px] leading-relaxed text-status-amber">
              You just made this server reachable beyond your LAN. A second factor is worth
              the two minutes.
            </p>
          )}
          <button
            type="button"
            onClick={begin}
            disabled={startSetup.isPending}
            className="w-full cursor-pointer rounded-[var(--system-radius-control)] border border-white/8 bg-white/[0.06] px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.09] disabled:opacity-60"
          >
            {startSetup.isPending ? "Preparing…" : "Set up two-factor"}
          </button>
        </>
      )}

      {phase === "enrolling" && enrollment && (
        <>
          <div className="flex gap-3">
            <div
              className="size-24 shrink-0 rounded-[12px] bg-white p-1.5 [&>svg]:size-full"
              // The SVG is generated server-side by the qrcode package in the
              // 2FA setup route — it is our own markup, not user input.
              dangerouslySetInnerHTML={{ __html: enrollment.qrCodeSvg }}
            />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">
                Scan with your authenticator
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/75">
                1Password, Bitwarden, Authy, or Google Authenticator.
              </p>
              <p className="mt-1.5 text-[10px] tracking-[0.16em] text-muted-foreground/60 uppercase">
                Or enter this key
              </p>
              <p className="font-mono text-[11px] break-all text-foreground/85">
                {enrollment.secret}
              </p>
            </div>
          </div>

          <label
            htmlFor="setup-totp-code"
            className="mt-3 mb-1.5 block px-1 text-[11px] tracking-[0.18em] text-muted-foreground/70 uppercase"
          >
            Six-digit code
          </label>
          <input
            id="setup-totp-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="h-11 w-full rounded-[var(--system-radius-control)] border border-white/6 bg-white/[0.035] px-3 font-mono text-[17px] tracking-[0.3em] text-foreground outline-none placeholder:text-muted-foreground/40 focus:bg-white/[0.05]"
          />
          <button
            type="button"
            onClick={confirm}
            disabled={code.length !== 6 || verify.isPending}
            className="mt-2 w-full cursor-pointer rounded-[var(--system-radius-control)] border border-white/8 bg-white/[0.06] px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.09] disabled:opacity-50"
          >
            {verify.isPending ? "Checking…" : "Turn on two-factor"}
          </button>
        </>
      )}

      {phase === "saved" && (
        <>
          <p className="px-1 text-[13px] font-medium text-status-green">
            Two-factor is on
          </p>
          <p className="mt-1 px-1 text-[11px] leading-relaxed text-muted-foreground/75">
            Save these backup codes somewhere safe. Each one works once, and this is the
            only time they are shown.
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-1.5">
            {backupCodes.map((backupCode) => (
              <li
                key={backupCode}
                className="rounded-[10px] border border-white/6 bg-black/25 px-2 py-1.5 text-center font-mono text-[12px] text-foreground/85"
              >
                {backupCode}
              </li>
            ))}
          </ul>
        </>
      )}

      {error && (
        <p className="mt-2 px-1 text-[11px] text-status-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
