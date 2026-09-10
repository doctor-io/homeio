"use client";

import { useState } from "react";

type BackupsStepProps = {
  onScheduledChange: (scheduled: boolean) => void;
};

const SCHEDULES = [
  { id: "0 3 * * *", label: "Every night", detail: "3:00 AM" },
  { id: "0 3 * * 0", label: "Every week", detail: "Sunday, 3:00 AM" },
] as const;

export function BackupsStep({ onScheduledChange }: BackupsStepProps) {
  const [choice, setChoice] = useState<string | null>(SCHEDULES[0].id);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function schedule() {
    if (!choice) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/scheduled-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Backup",
          taskType: "backup",
          taskConfig: { type: "backup" },
          cronExpression: choice,
          enabled: true,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not create the backup task");
      }

      setCreated(true);
      onScheduledChange(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the backup task");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="system-soft-surface p-3 text-left" data-testid="backups-step">
        <p className="text-sm text-foreground">Backup scheduled</p>
        <p className="mt-1 text-2xs text-muted-foreground/70">
          It runs in the background. Change the schedule, or restore from a backup, in
          Settings · Backup &amp; Restore.
        </p>
      </div>
    );
  }

  return (
    <div className="system-soft-surface p-2.5 text-left" data-testid="backups-step">
      {SCHEDULES.map((option) => (
        <button
          key={option.id}
          type="button"
          data-testid={`backup-${option.id.replace(/[^a-z0-9]/gi, "")}`}
          onClick={() => setChoice(option.id)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--system-radius-control)] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.03]"
        >
          <span
            aria-hidden="true"
            className={`size-3 shrink-0 rounded-full border transition-colors ${
              choice === option.id
                ? "border-primary bg-primary"
                : "border-muted-foreground/40"
            }`}
          />
          <span className="flex-grow text-sm text-foreground/85">{option.label}</span>
          <span className="text-2xs text-muted-foreground/60">{option.detail}</span>
        </button>
      ))}

      <button
        type="button"
        disabled={busy || !choice}
        onClick={() => void schedule()}
        className="mt-2 w-full cursor-pointer rounded-[var(--system-radius-control)] border border-glass-border bg-background/55 px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Scheduling…" : "Schedule it"}
      </button>

      {error && (
        <p className="system-error-capsule mt-2 text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
