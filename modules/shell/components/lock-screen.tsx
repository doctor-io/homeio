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
  // No default: the desktop passes the live appearance, and anything that does
  // not should fall through to FullScreenShell's own read of the stored
  // wallpaper rather than being pinned to the first one in the list.
  wallpaper,
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
    <div className="fixed inset-0 z-[500]">
      <FullScreenShell
        wallpaper={wallpaper}
        topRight={
          <button
            className="system-dock-surface flex size-10 cursor-pointer items-center justify-center text-foreground/68 transition-colors hover:border-white/10 hover:bg-black/26 hover:text-foreground disabled:opacity-60"
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
            <div className="mx-auto mb-5 flex w-fit flex-col items-center">
              <div className="system-hero-surface flex size-24 items-center justify-center bg-black/22 shadow-[var(--system-shadow-dock)]">
                <Image
                  src="/icon.png"
                  alt="Homeio"
                  width={64}
                  height={64}
                  className="relative z-10 size-[3.65rem] blur-[0.15px]"
                />
              </div>
              <div className="system-pill-surface mt-2.5 px-3 py-1 text-3xs tracking-[0.24em] text-foreground/58 uppercase">
                Home server
              </div>
            </div>

            <p className="text-2xl font-medium tracking-[-0.03em] text-foreground">
              {displayUsername}
            </p>
            <p className="mb-5 mt-1 text-2xs tracking-[0.18em] text-muted-foreground/78 uppercase">
              Locked session
            </p>

            <form className="space-y-3" onSubmit={handleUnlock}>
              <div className="system-soft-surface bg-black/22 px-2.5 py-2 shadow-[var(--system-shadow-dock)]">
                <div className="flex items-center gap-2">
                  <div className="system-icon-surface flex size-10 shrink-0 items-center justify-center bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <Lock className="size-[1.1rem]" />
                  </div>

                  <input
                    type={isPasswordVisible ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="h-10 w-full border-0 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground/52"
                    autoFocus
                  />

                  <button
                    type="button"
                    className="flex size-10 shrink-0 items-center justify-center rounded-[var(--system-radius-control)] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
                    className="system-primary-action group flex h-10 shrink-0 items-center gap-2 px-4 text-sm font-medium transition-all hover:translate-x-0.5 hover:brightness-110 disabled:translate-x-0 disabled:cursor-not-allowed disabled:opacity-45"
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

            <p className="mt-4 text-xs text-muted-foreground">
              Press{" "}
              <span className="system-keycap-surface px-1.5 py-0.5 text-2xs text-foreground/90">
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
