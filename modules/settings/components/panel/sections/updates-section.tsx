"use client";

import {
  InfoBanner,
  SectionDivider,
  Toggle,
} from "@/modules/settings/components/panel/controls";
import {
  SETTINGS_PANEL_INSET,
} from "@/modules/settings/components/panel/surface";
import type { SettingsBackend } from "@/modules/settings/components/panel/types";
import { RefreshCw } from "@/components/icons/platform-icons";
import { cn } from "@/lib/utils";

type UpdatesSectionProps = {
  data: SettingsBackend["updates"];
  capabilities: SettingsBackend["capabilities"]["updates"];
  onCheckForUpdates: () => void;
  onApplyUpdate: () => void;
  autoCheckEnabled: boolean;
  onToggleAutoCheck: (enabled: boolean) => void;
};

export function UpdatesSection({
  data,
  capabilities,
  onCheckForUpdates,
  onApplyUpdate,
  autoCheckEnabled,
  onToggleAutoCheck,
}: UpdatesSectionProps) {
  const hasUpdate = data.updateAvailable && !!data.latestVersion;
  const lastCheckedLabel = data.checkedAt
    ? new Date(data.checkedAt).toLocaleString()
    : "Never";

  return (
    <div className="flex flex-col gap-1">
      {data.warning && (
        <InfoBanner text={data.warning} variant={data.unavailable ? "warning" : "info"} />
      )}
      {data.checkError && <InfoBanner text={data.checkError} variant="warning" />}
      {data.applyError && <InfoBanner text={data.applyError} variant="warning" />}
      {data.isRecoveryActive && (
        <InfoBanner
          text="Homeio is restarting to finish the update. This page will reconnect automatically."
          variant="info"
        />
      )}

      {/* ── Status card ── */}
      <SectionDivider title="Homeio" />
      <div className={cn(SETTINGS_PANEL_INSET, "overflow-hidden")}>
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "size-2 rounded-full",
              hasUpdate ? "bg-status-amber" : "bg-status-green",
            )} />
            <span className="text-sm font-medium text-foreground">
              {hasUpdate ? `v${data.latestVersion} available` : "Up to date"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onCheckForUpdates}
              disabled={capabilities.checkForUpdates.disabled || data.isChecking || data.isRecoveryActive}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg md:min-h-0 handheld:!min-h-11 border border-glass-border bg-background/55 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", data.isChecking && "animate-spin")} />
              {data.isChecking ? "Checking…" : "Check"}
            </button>
            {hasUpdate && (
              <button
                onClick={onApplyUpdate}
                disabled={capabilities.updateHomeio.disabled || data.isApplying || data.isRecoveryActive}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg md:min-h-0 handheld:!min-h-11 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {data.isApplying || data.isRecoveryActive ? "Updating…" : "Update"}
              </button>
            )}
          </div>
        </div>

        {/* Version rows */}
        <div className="divide-y divide-glass-border/50 border-t border-glass-border/50 px-4">
          <div className="flex items-center justify-between py-2.5">
            <span className="text-xs text-muted-foreground">Current version</span>
            <span className="font-mono text-xs font-medium text-foreground">{data.currentVersion}</span>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <span className="text-xs text-muted-foreground">Latest version</span>
            <span className="font-mono text-xs font-medium text-foreground">
              {data.latestVersion ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <span className="text-xs text-muted-foreground">Last checked</span>
            <span className="text-xs text-foreground">{lastCheckedLabel}</span>
          </div>
        </div>
      </div>

      {/* ── Preferences ── */}
      <SectionDivider title="Preferences" />
      <div className={cn(SETTINGS_PANEL_INSET, "px-4 py-1")}>
        <Toggle
          label="Auto-check for updates"
          description="Check for new updates daily"
          enabled={autoCheckEnabled}
          onToggle={() => onToggleAutoCheck(!autoCheckEnabled)}
          disabled={capabilities.autoCheck.disabled}
          disabledReason={capabilities.autoCheck.disabledReason}
        />
      </div>
    </div>
  );
}
