"use client";

import { useEffect } from "react";

type TimezoneStepProps = {
  value: string | null;
  onChange: (value: string) => void;
};

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function listTimezones(): string[] {
  try {
    // supportedValuesOf is ES2022; older engines fall back to the detected zone
    // alone, which still lets the step complete.
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported?.length) return supported;
  } catch {
    /* fall through */
  }
  return [];
}

function formatPreview(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date());
  } catch {
    return null;
  }
}

export function TimezoneStep({ value, onChange }: TimezoneStepProps) {
  // No useMemo here: the React Compiler memoizes these itself, and hand-rolled
  // memoization it cannot preserve is a lint error in this repo.
  const detected = detectTimezone();
  const all = listTimezones();
  const zones =
    all.length === 0 ? [detected] : all.includes(detected) ? all : [detected, ...all];

  // Seed the answer from the browser so Continue does the expected thing
  // without the user touching anything.
  useEffect(() => {
    if (!value) onChange(detected);
  }, [detected, onChange, value]);

  const selected = value ?? detected;
  const preview = formatPreview(selected);

  return (
    <div className="system-soft-surface p-2.5 text-left">
      <label
        htmlFor="setup-timezone"
        className="mb-1.5 block px-1 text-[11px] tracking-[0.18em] text-muted-foreground/70 uppercase"
      >
        Time zone
      </label>

      <select
        id="setup-timezone"
        value={selected}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full cursor-pointer rounded-[var(--system-radius-control)] border border-white/6 bg-white/[0.035] px-3 text-[15px] text-foreground outline-none transition-colors hover:bg-white/[0.05] focus:bg-white/[0.05]"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone} className="bg-neutral-900">
            {zone}
            {zone === detected ? " — detected" : ""}
          </option>
        ))}
      </select>

      {preview && (
        <p className="mt-2 px-1 text-[11px] text-muted-foreground/70">
          Server clock would read <span className="text-foreground/80">{preview}</span>
        </p>
      )}
    </div>
  );
}
