"use client";

import Image from "next/image";
import { FullScreenShell } from "@/modules/shell/components/full-screen-shell";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Power,
} from "@/components/icons/platform-icons";
import { type FormEvent, useState } from "react";

type LockScreenProps = {
  onUnlock: (password: string) => Promise<void>;
  onLogout: () => Promise<void>;
  username: string;
  wallpaper?: string;
};

export function LockScreen({
  onUnlock,
  onLogout,
  username,
  wallpaper = "/images/1.jpg",
}: LockScreenProps) {
  const displayUsername = username.replace(
    /\b([a-z])/gi,
    (letter) => letter.toUpperCase(),
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim()) return;

    setError(null);
    setIsUnlocking(true);

    try {
      await onUnlock(password);
      setPassword("");
    } catch (unlockError) {
      setError(
        unlockError instanceof Error ? unlockError.message : "Unlock failed",
      );
    } finally {
      setIsUnlocking(false);
    }
  }

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await onLogout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[500] overflow-y-auto">
      <FullScreenShell
        compactOnMobile
        wallpaper={wallpaper}
        topRight={
          <button
            className="system-dock-surface flex size-11 cursor-pointer items-center justify-center text-foreground/68 transition-colors hover:border-white/10 hover:bg-black/26 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 sm:size-10"
            aria-label="Logout"
            title="Logout"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            <Power className="size-4" />
          </button>
        }
        center={
          <div className="w-full max-w-md text-center">
            <div className="mx-auto mb-5 flex w-fit flex-col items-center handheld:mx-0 handheld:mb-4 handheld:items-start">
              <div className="system-hero-surface flex size-24 items-center justify-center bg-black/22 shadow-[var(--system-shadow-dock)] handheld:size-14 handheld:bg-[var(--mobile-panel)] handheld:shadow-none">
                <Image
                  src="/icon.png"
                  alt="Homeio"
                  width={64}
                  height={64}
                  className="relative z-10 size-[3.65rem] blur-[0.15px] handheld:size-10 handheld:blur-none"
                />
              </div>
              <div className="system-pill-surface mt-2.5 px-3 py-1 text-[10px] tracking-[0.24em] text-foreground/58 uppercase handheld:hidden">
                Home server
              </div>
            </div>

            <h1 className="text-[1.48rem] font-medium tracking-[-0.03em] text-foreground handheld:text-left handheld:text-3xl">
              {displayUsername}
            </h1>
            <p className="mb-5 mt-1 text-[11px] tracking-[0.18em] text-muted-foreground/78 uppercase handheld:text-left handheld:text-sm handheld:tracking-normal handheld:normal-case">
              Locked session
            </p>

            <form className="space-y-3" onSubmit={handleUnlock}>
              <div className="system-soft-surface bg-black/22 px-2.5 py-2 shadow-[var(--system-shadow-dock)]">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:flex handheld:grid">
                  <div className="system-icon-surface flex size-10 shrink-0 items-center justify-center bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <Lock className="size-[1.1rem]" />
                  </div>

                  <input
                    type={isPasswordVisible ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="h-11 min-w-0 w-full border-0 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground/52 sm:h-10 sm:text-[15px]"
                    aria-label="Password"
                    autoComplete="current-password"
                    autoFocus
                  />

                  <button
                    type="button"
                    className="flex size-11 shrink-0 items-center justify-center rounded-[var(--system-radius-control)] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:size-10"
                    aria-label={
                      isPasswordVisible ? "Hide password" : "Show password"
                    }
                    onClick={() =>
                      setIsPasswordVisible((currentValue) => !currentValue)
                    }
                  >
                    {isPasswordVisible ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>

                  <button
                    type="submit"
                    className="system-primary-action group col-span-full flex h-11 shrink-0 items-center justify-center gap-2 px-4 text-sm font-medium transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 sm:h-10"
                    disabled={isUnlocking || !password.trim()}
                  >
                    <span>{isUnlocking ? "Unlocking..." : "Unlock"}</span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </div>
              </div>

              {error ? (
                <div className="flex justify-center">
                  <div className="system-error-capsule">
                    <span className="size-1.5 shrink-0 rounded-full bg-status-red shadow-[0_0_10px_rgba(239,68,68,0.45)]" />
                    <p className="text-xs tracking-[0.01em] text-status-red/92">
                      {error}
                    </p>
                  </div>
                </div>
              ) : null}
            </form>

            <p className="mt-4 hidden text-xs text-muted-foreground sm:block">
              Press{" "}
              <span className="system-keycap-surface px-1.5 py-0.5 text-[11px] text-foreground/90">
                Command + L
              </span>{" "}
              anytime to lock
            </p>
          </div>
        }
      />
    </div>
  );
}
