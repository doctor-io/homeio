"use client";

import Image from "next/image";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  UserRound,
} from "@/components/icons/platform-icons";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

type WizardStep = "welcome" | "account" | "setup" | "done";

const WIZARD_STEPS: WizardStep[] = ["welcome", "account", "setup", "done"];

const setupSteps = [
  {
    title: "Creating your account",
    description: "Saving credentials and creating the first session.",
  },
  {
    title: "Preparing storage",
    description: "Creating required folders and workspace paths.",
  },
  {
    title: "Setting up the App Store",
    description: "Downloading and indexing the default catalog.",
  },
] as const;

export function RegisterForm() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("welcome");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setupStage, setSetupStage] = useState(0);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  // Frozen at submit time so the setup effect doesn't need state deps
  const credentials = useRef({ username: "", password: "", confirmPassword: "" });

  useEffect(() => {
    if (step !== "setup") return;

    const data = credentials.current;
    let cancelled = false;
    setSetupStage(0);

    const t1 = window.setTimeout(() => { if (!cancelled) setSetupStage(1); }, 1200);
    const t2 = window.setTimeout(() => { if (!cancelled) setSetupStage(2); }, 3200);

    const register = fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? "Registration failed");
      }
    });

    const minWait = new Promise<void>((resolve) => setTimeout(resolve, 4400));

    Promise.all([register, minWait])
      .then(() => { if (!cancelled) setStep("done"); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Registration failed");
          setStep("account");
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [step]); // credentials are frozen in a ref at submit time

  function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setError(null);
    credentials.current = { username, password, confirmPassword };
    setStep("setup");
  }

  const currentSetupStep = setupSteps[setupStage];
  const stepIndex = WIZARD_STEPS.indexOf(step);

  return (
    <div className="w-full text-center">
      {/* Step indicator — hidden during setup which has its own internal progress */}
      {step !== "setup" && (
        <div className="mb-8 flex justify-center gap-2">
          {WIZARD_STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-[3px] rounded-full transition-all duration-500 ${
                i === stepIndex
                  ? "w-6 bg-white"
                  : i < stepIndex
                  ? "w-4 bg-white/35"
                  : "w-4 bg-white/12"
              }`}
            />
          ))}
        </div>
      )}

      {step === "welcome" && (
        <div>
          <div className="mx-auto mb-6 flex w-fit flex-col items-center">
            <div className="system-hero-surface flex size-[5.5rem] items-center justify-center">
              <Image
                src="/icon.png"
                alt="Homeio"
                width={64}
                height={64}
                className="relative z-10 size-[3.4rem] blur-[0.12px]"
              />
            </div>
            <div className="system-pill-surface mt-2 px-3 py-1 text-3xs tracking-[0.22em] text-foreground/54 uppercase">
              Home server
            </div>
          </div>

          <p className="text-[1.6rem] font-medium leading-[1.2] tracking-[-0.03em] text-foreground">
            Welcome to your<br />Home Server
          </p>
          <p className="mx-auto mb-7 mt-2.5 max-w-[22rem] text-xs leading-relaxed text-muted-foreground/72">
            Set up your private home server in minutes. All your files, apps,
            and settings — in one place.
          </p>

          <button
            type="button"
            onClick={() => setStep("account")}
            className="system-primary-action inline-flex cursor-pointer items-center gap-2 rounded-full px-8 py-2.5 text-sm font-medium transition-all hover:brightness-110"
          >
            Get Started
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}

      {step === "account" && (
        <div>
          <div className="mx-auto mb-5 flex w-fit flex-col items-center">
            <div className="system-hero-surface flex size-22 items-center justify-center">
              <Image
                src="/icon.png"
                alt="Homeio"
                width={64}
                height={64}
                className="relative z-10 size-[3.2rem] blur-[0.12px]"
              />
            </div>
            <div className="system-pill-surface mt-2 px-3 py-1 text-3xs tracking-[0.22em] text-foreground/54 uppercase">
              Home server
            </div>
          </div>

          <p className="text-2xl font-medium tracking-[-0.03em] text-foreground">
            Create admin account
          </p>
          <p className="mb-5 mt-1 text-2xs tracking-[0.18em] text-muted-foreground/78 uppercase">
            Configure local access
          </p>

          <form className="space-y-3 text-left" onSubmit={handleAccountSubmit}>
            <div className="system-soft-surface px-2.5 py-2">
              <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-white/10" />
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 rounded-[var(--system-radius-control)] border border-white/6 bg-white/[0.035] px-2 py-1.5 transition-colors hover:bg-white/[0.05] focus-within:bg-white/[0.05]">
                  <div className="system-icon-surface flex size-9 shrink-0 items-center justify-center bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <UserRound className="size-[1.1rem]" />
                  </div>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Admin username"
                    className="h-10 w-full border-0 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground/52"
                    required
                    autoFocus
                  />
                </div>

                <div className="flex items-center gap-2 rounded-[var(--system-radius-control)] border border-white/6 bg-white/[0.035] px-2 py-1.5 transition-colors hover:bg-white/[0.05] focus-within:bg-white/[0.05]">
                  <div className="system-icon-surface flex size-9 shrink-0 items-center justify-center bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <Lock className="size-[1.2rem]" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type={isPasswordVisible ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="New password"
                    className="h-10 w-full border-0 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground/52"
                    required
                  />
                  <button
                    type="button"
                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--system-radius-icon)] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                    onClick={() => setIsPasswordVisible((v) => !v)}
                  >
                    {isPasswordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>

                <div className="flex items-center gap-2 rounded-[var(--system-radius-control)] border border-white/6 bg-white/[0.035] px-2 py-1.5 transition-colors hover:bg-white/[0.05] focus-within:bg-white/[0.05]">
                  <div className="system-icon-surface flex size-9 shrink-0 items-center justify-center bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <Lock className="size-[1.2rem]" />
                  </div>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={isConfirmPasswordVisible ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="h-10 w-full border-0 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground/52"
                    required
                  />
                  <button
                    type="button"
                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--system-radius-icon)] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    aria-label={isConfirmPasswordVisible ? "Hide confirm password" : "Show confirm password"}
                    onClick={() => setIsConfirmPasswordVisible((v) => !v)}
                  >
                    {isConfirmPasswordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            </div>

            {error ? (
              <div className="flex justify-center">
                <div className="system-error-capsule">
                  <span className="size-1.5 shrink-0 rounded-full bg-status-red shadow-[0_0_10px_rgba(239,68,68,0.45)]" />
                  <p className="text-xs tracking-[0.01em] text-status-red/92">{error}</p>
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={
                !username.trim() ||
                !password.trim() ||
                !confirmPassword.trim() ||
                password !== confirmPassword
              }
              className="system-primary-action w-full cursor-pointer rounded-full py-2.5 text-sm font-medium transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          </form>

          <button
            type="button"
            onClick={() => { setError(null); setStep("welcome"); }}
            className="mt-4 text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground/80"
          >
            ← Back
          </button>
        </div>
      )}

      {step === "setup" && (
        <div>
          <div className="mx-auto mb-4 flex w-fit flex-col items-center">
            <div className="system-hero-surface flex size-22 items-center justify-center">
              <Image
                src="/icon.png"
                alt="Homeio"
                width={64}
                height={64}
                className="relative z-10 size-[3.2rem] blur-[0.12px]"
              />
            </div>
            <div className="system-pill-surface mt-2 px-3 py-1 text-3xs tracking-[0.22em] text-foreground/54 uppercase">
              Home server
            </div>
          </div>

          <p className="text-[1.4rem] font-medium tracking-[-0.03em] text-foreground">
            {currentSetupStep?.title}
          </p>
          <p className="mb-4 mt-1 text-2xs tracking-[0.18em] text-muted-foreground/80 uppercase">
            Setup in progress
          </p>

          <div className="system-soft-surface px-2.5 py-2">
            <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-white/10" />
            <div className="rounded-[var(--system-radius-control)] px-2 py-2.5 text-left">
              <div className="mb-3.5 flex gap-2">
                {setupSteps.map((s, i) => (
                  <span
                    key={s.title}
                    className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
                      i <= setupStage ? "bg-white" : "bg-white/10"
                    }`}
                  />
                ))}
              </div>

              <p className="text-sm font-medium text-foreground">
                {currentSetupStep?.description}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground/92">
                First launch may take longer while background services finish
                initialization.
              </p>

              <div className="mt-3.5 flex items-center gap-3">
                <span className="inline-flex size-8 shrink-0 animate-spin rounded-full border border-white/18 border-t-white" />
                <span className="text-xs tracking-[0.18em] text-foreground/62 uppercase">
                  Working
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === "done" && (
        <div>
          <div className="mx-auto mb-6 flex w-fit flex-col items-center">
            <div className="system-hero-surface flex size-[5.5rem] items-center justify-center">
              <Image
                src="/icon.png"
                alt="Homeio"
                width={64}
                height={64}
                className="relative z-10 size-[3.4rem] blur-[0.12px]"
              />
            </div>
            <div className="system-pill-surface mt-2 px-3 py-1 text-3xs tracking-[0.22em] text-foreground/54 uppercase">
              Home server
            </div>
          </div>

          <p className="text-[1.6rem] font-medium leading-[1.2] tracking-[-0.03em] text-foreground">
            You&apos;re all set
          </p>
          <p className="mx-auto mb-7 mt-2.5 max-w-[22rem] text-xs leading-relaxed text-muted-foreground/72">
            Your home server is ready. A few questions and it is yours.
          </p>

          <button
            type="button"
            onClick={() => {
              router.replace("/");
              router.refresh();
            }}
            className="system-primary-action inline-flex cursor-pointer items-center gap-2 rounded-full px-8 py-2.5 text-sm font-medium transition-all hover:brightness-110"
          >
            Continue setup
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
