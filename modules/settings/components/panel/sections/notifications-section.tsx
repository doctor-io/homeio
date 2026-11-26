"use client";

import { SectionDivider, Toggle } from "@/modules/settings/components/panel/controls";
import { SETTINGS_PANEL_INSET } from "@/modules/settings/components/panel/surface";
import type { NotificationSettingsDraft } from "@/modules/settings/components/panel/types";
import { cn } from "@/lib/utils";

type NotificationsSectionProps = {
  draft: NotificationSettingsDraft;
  onChange: (patch: Partial<NotificationSettingsDraft>) => void;
};

function ThresholdRow({
  label,
  description,
  value,
  unit,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  unit: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={cn(SETTINGS_PANEL_INSET, "flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:gap-4")}>
      <div className="min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] text-muted-foreground/70">{description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type="number"
          min={1}
          className="h-8 w-20 rounded-lg border border-glass-border bg-background/55 px-3 text-right text-xs text-foreground focus:border-primary/40 focus:outline-none"
        />
        <span className="w-6 text-[11px] text-muted-foreground/60">{unit}</span>
      </div>
    </div>
  );
}

export function NotificationsSection({ draft, onChange }: NotificationsSectionProps) {
  return (
    <div className="flex flex-col gap-1">
      <SectionDivider title="Alert Types" />
      <div className="flex flex-col gap-1.5">
        {[
          {
            label: "System alerts",
            description: "CPU overload, high temperature, low disk space",
            key: "systemAlertsEnabled" as const,
          },
          {
            label: "Update notifications",
            description: "Homeio update availability in the desktop alert center",
            key: "updateNotificationsEnabled" as const,
          },
          {
            label: "Backup reports",
            description: "Backup success and failure notifications",
            key: "backupReportsEnabled" as const,
          },
        ].map(({ label, description, key }) => (
          <div key={key} className={cn(SETTINGS_PANEL_INSET, "px-4 py-1")}>
            <Toggle
              label={label}
              description={description}
              enabled={draft[key]}
              onToggle={() => onChange({ [key]: !draft[key] })}
            />
          </div>
        ))}

        <div className={cn(SETTINGS_PANEL_INSET, "px-4 py-1")}>
          <Toggle
            label="Security events"
            description="Failed logins, firewall blocks, certificate expiry"
            enabled={draft.securityEventsEnabled}
            onToggle={() => undefined}
            disabled
            disabledReason="Coming soon"
          />
        </div>
      </div>

      <SectionDivider title="Thresholds" />
      <div className="flex flex-col gap-1.5">
        <ThresholdRow
          label="CPU usage"
          description="Alert when CPU exceeds this level"
          value={draft.cpuAlertThresholdPercent}
          unit="%"
          onChange={(v) => onChange({ cpuAlertThresholdPercent: v })}
        />
        <ThresholdRow
          label="Memory usage"
          description="Alert when RAM exceeds this level"
          value={draft.memoryAlertThresholdPercent}
          unit="%"
          onChange={(v) => onChange({ memoryAlertThresholdPercent: v })}
        />
        <ThresholdRow
          label="Disk space"
          description="Alert when disk usage exceeds this level"
          value={draft.diskAlertThresholdPercent}
          unit="%"
          onChange={(v) => onChange({ diskAlertThresholdPercent: v })}
        />
        <ThresholdRow
          label="Temperature"
          description="Alert when CPU temperature exceeds this level"
          value={draft.temperatureAlertThresholdCelsius}
          unit="°C"
          onChange={(v) => onChange({ temperatureAlertThresholdCelsius: v })}
        />
      </div>
    </div>
  );
}
