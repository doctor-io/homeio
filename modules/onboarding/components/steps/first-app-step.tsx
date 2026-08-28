"use client";

import { useEffect, useState } from "react";
import type { StoreAppSummary } from "@/lib/shared/contracts/apps";

type FirstAppStepProps = {
  selectedAppId: string | null;
  onChange: (app: { id: string; name: string } | null) => void;
};

type Phase = "loading" | "ready" | "unavailable";

// Used only when the catalog offers no recommendations of its own.
const FALLBACK_STARTERS = [
  "jellyfin",
  "nextcloud",
  "home-assistant",
  "vaultwarden",
  "immich",
  "pi-hole",
];

const TILE_LIMIT = 6;

function pickStarters(apps: StoreAppSummary[], recommendedIds: string[]): StoreAppSummary[] {
  const notInstalled = apps.filter((app) => app.status === "not_installed");
  const pool = notInstalled.length ? notInstalled : apps;

  const recommended = recommendedIds
    .map((id) => pool.find((app) => app.id === id))
    .filter((app): app is StoreAppSummary => Boolean(app));
  if (recommended.length) return recommended.slice(0, TILE_LIMIT);

  const byName = FALLBACK_STARTERS.map((slug) =>
    pool.find((app) => app.id === slug || app.name.toLowerCase() === slug.replace("-", " ")),
  ).filter((app): app is StoreAppSummary => Boolean(app));
  if (byName.length) return byName.slice(0, TILE_LIMIT);

  return pool.slice(0, TILE_LIMIT);
}

export function FirstAppStep({ selectedAppId, onChange }: FirstAppStepProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [apps, setApps] = useState<StoreAppSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/v1/store/apps");
        if (!response.ok) throw new Error(`Catalog failed (${response.status})`);

        const json = (await response.json()) as {
          data: StoreAppSummary[];
          meta?: { recommendedAppIds?: string[] };
        };
        if (cancelled) return;

        const starters = pickStarters(json.data ?? [], json.meta?.recommendedAppIds ?? []);
        setApps(starters);
        setPhase(starters.length ? "ready" : "unavailable");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="system-soft-surface p-2.5 text-left">
      {phase === "loading" && (
        <p className="px-1 py-3 text-center text-[12px] text-muted-foreground/70">
          Loading the app store…
        </p>
      )}

      {phase === "unavailable" && (
        <p className="px-1 py-2 text-[11px] leading-relaxed text-muted-foreground/70">
          The app store catalog is not available yet. Skip this — the store is on your dock
          once setup finishes.
        </p>
      )}

      {phase === "ready" && (
        <div className="grid grid-cols-3 gap-1.5">
          {apps.map((app) => {
            const isSelected = selectedAppId === app.id;
            return (
              <button
                key={app.id}
                type="button"
                aria-pressed={isSelected}
                // Selecting the same tile again clears it, so there is always a
                // way back to installing nothing without leaving the step.
                onClick={() => onChange(isSelected ? null : { id: app.id, name: app.name })}
                className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[var(--system-radius-control)] border px-1.5 py-2.5 transition-colors ${
                  isSelected
                    ? "border-primary/50 bg-white/[0.07]"
                    : "border-white/6 bg-white/[0.035] hover:bg-white/[0.05]"
                }`}
              >
                <span className="flex size-8 items-center justify-center overflow-hidden rounded-[10px] border border-white/8 bg-white/10">
                  {app.logoUrl ? (
                    // Catalog logos are remote and unoptimised elsewhere in the
                    // app too; a plain img keeps this consistent.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={app.logoUrl} alt="" className="size-full object-contain" />
                  ) : (
                    <span className="text-[11px] text-foreground/70">
                      {app.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-[10.5px] text-foreground/80">
                  {app.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
