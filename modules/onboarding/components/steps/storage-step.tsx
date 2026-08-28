"use client";

import { useEffect, useState } from "react";
import type { DiskDevice, DiskListResponse } from "@/lib/shared/contracts/disks";

type StorageStepProps = {
  value: string | null;
  onChange: (value: string) => void;
};

type StorageOption = {
  mountpoint: string;
  label: string;
  detail: string;
  isSystemDisk: boolean;
};

type LoadState = "loading" | "ready" | "unavailable";

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "size unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function toOptions(disks: DiskDevice[]): StorageOption[] {
  return disks.flatMap((disk) =>
    disk.partitions
      .filter((partition) => Boolean(partition.mountpoint) && !partition.ro)
      .map((partition) => ({
        mountpoint: partition.mountpoint as string,
        label: partition.label || disk.model || disk.name,
        detail: [partition.fstype, formatSize(partition.sizeBytes), partition.mountpoint]
          .filter(Boolean)
          .join(" · "),
        isSystemDisk: partition.mountpoint === "/",
      })),
  );
}

export function StorageStep({ value, onChange }: StorageStepProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [options, setOptions] = useState<StorageOption[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/v1/system/disks");
        if (!response.ok) throw new Error(`Disk list failed (${response.status})`);

        const json = (await response.json()) as { data: DiskListResponse };
        const found = toOptions(json.data?.disks ?? []);
        if (cancelled) return;

        setOptions(found);
        // No disks is not an error: Docker without the host block devices, or a
        // dev machine, both land here. Fall back to typing a path.
        setState(found.length ? "ready" : "unavailable");
      } catch {
        if (!cancelled) setState("unavailable");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedIsSystemDisk = value === "/";

  return (
    <div className="system-soft-surface p-2.5 text-left">
      {state === "loading" && (
        <p className="px-1 py-3 text-center text-[12px] text-muted-foreground/70">
          Looking for drives…
        </p>
      )}

      {state === "ready" &&
        options.map((option) => {
          const isSelected = value === option.mountpoint;
          return (
            <button
              key={option.mountpoint}
              type="button"
              onClick={() => onChange(option.mountpoint)}
              aria-pressed={isSelected}
              className={`mb-1.5 flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--system-radius-control)] border px-2.5 py-2 text-left transition-colors last:mb-0 ${
                isSelected
                  ? "border-primary/50 bg-white/[0.06]"
                  : "border-white/6 bg-white/[0.035] hover:bg-white/[0.05]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-4 shrink-0 rounded-full border ${
                  isSelected ? "border-primary bg-primary/80" : "border-white/25"
                }`}
              />
              <span className="min-w-0 flex-grow">
                <span className="block truncate text-[14px] font-medium text-foreground">
                  {option.label}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground/80">
                  {option.detail}
                </span>
              </span>
            </button>
          );
        })}

      {state === "unavailable" && (
        <>
          <label
            htmlFor="setup-storage-path"
            className="mb-1.5 block px-1 text-[11px] tracking-[0.18em] text-muted-foreground/70 uppercase"
          >
            Storage path
          </label>
          <input
            id="setup-storage-path"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder="/DATA"
            className="h-11 w-full rounded-[var(--system-radius-control)] border border-white/6 bg-white/[0.035] px-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/52 focus:bg-white/[0.05]"
          />
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground/70">
            No drives were detected — that is normal in Docker without host block devices.
            Type a path, or skip and set it later in Settings.
          </p>
        </>
      )}

      {selectedIsSystemDisk && (
        <p className="mt-2 rounded-[var(--system-radius-control)] border border-status-amber/20 bg-status-amber/10 px-2.5 py-2 text-[11px] leading-relaxed text-status-amber">
          App data on the system disk fills the root partition. A separate drive is safer.
        </p>
      )}
    </div>
  );
}
