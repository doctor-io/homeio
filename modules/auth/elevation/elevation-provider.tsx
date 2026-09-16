"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ElevationCancelledError,
  isElevationRequired,
} from "@/modules/auth/elevation/elevation-error";

/**
 * One password prompt, shared by everything that can be refused for want of one.
 *
 * The alternative was a dialog per call site — five of them, drifting — and a
 * decision at each about what to do with the refusal. This makes the whole
 * thing one wrapper: run the action, and if the server asks for the password,
 * ask the user and run it again.
 *
 * `runElevated` resolves with the action's own result, so a caller that does
 * not care about elevation reads exactly as it did before.
 */

type ElevationContextValue = {
  runElevated: <T>(action: () => Promise<T>) => Promise<T>;
};

const ElevationContext = createContext<ElevationContextValue | null>(null);

type PendingPrompt = {
  resolve: () => void;
  reject: (reason: unknown) => void;
};

export { ElevationCancelledError };

async function requestElevation(password: string) {
  const response = await fetch("/api/v1/auth/elevate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Could not confirm your password");
  }
}

export function ElevationProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef<PendingPrompt | null>(null);

  const closePrompt = useCallback(() => {
    setOpen(false);
    // The field holds a password; it should not sit in React state a moment
    // longer than the dialog it belongs to.
    setPassword("");
    setError(null);
    setSubmitting(false);
  }, []);

  /**
   * Resolves once the server has accepted a password — not with the password.
   *
   * The dialog has to verify before it closes, so a typo is corrected here
   * rather than surfacing later as a failed wipe. Handing the password back for
   * the caller to send again would mean two `/elevate` calls per prompt, two
   * attempts against the login rate limit, and the password living one hop
   * longer than it needs to.
   */
  const confirmIdentity = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject };
      setError(null);
      setPassword("");
      setOpen(true);
    });
  }, []);

  const runElevated = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (caught) {
        if (!isElevationRequired(caught)) throw caught;

        // Only ever one retry. If the server still refuses after a password it
        // accepted, something other than elevation is wrong and looping on it
        // would just ask again for no reason.
        await confirmIdentity();
        return action();
      }
    },
    [confirmIdentity],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password) return;

    setSubmitting(true);
    setError(null);

    try {
      await requestElevation(password);
      const resolve = pending.current?.resolve;
      pending.current = null;
      closePrompt();
      resolve?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not confirm your password");
      setSubmitting(false);
    }
  }

  function cancel() {
    const reject = pending.current?.reject;
    pending.current = null;
    closePrompt();
    reject?.(new ElevationCancelledError());
  }

  return (
    <ElevationContext.Provider value={{ runElevated }}>
      {children}

      <Dialog open={open} onOpenChange={(next) => { if (!next) cancel(); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Confirm it&apos;s you</DialogTitle>
              <DialogDescription>
                This action cannot be undone, so Homeio asks for your password
                again before doing it. You won&apos;t be asked again for a few
                minutes, unless the server restarts.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 py-4">
              <Label htmlFor="elevation-password">Password</Label>
              <Input
                id="elevation-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(error)}
              />
              {error ? (
                <p className="text-sm text-status-red" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={!password || submitting}>
                {submitting ? "Confirming…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ElevationContext.Provider>
  );
}

/**
 * Wraps an action so a refusal for want of a password becomes a prompt.
 *
 * Outside a provider it runs the action unchanged rather than throwing: a
 * missing provider should not break a page, and the server refuses anyway —
 * the guarantee is on the server, this is only the courtesy.
 */
export function useElevation(): ElevationContextValue {
  const context = useContext(ElevationContext);
  return context ?? { runElevated: (action) => action() };
}
