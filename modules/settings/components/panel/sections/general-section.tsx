"use client";

import { Cpu, MemoryStick, MonitorSpeaker, Thermometer } from "@/components/icons/platform-icons";
import {
  InfoBanner,
  SectionDivider,
} from "@/modules/settings/components/panel/controls";
import {
  SETTINGS_BADGE_SURFACE,
  SETTINGS_PANEL_INSET,
} from "@/modules/settings/components/panel/surface";
import type { SettingsBackend } from "@/modules/settings/components/panel/types";
import { cn } from "@/lib/utils";

type GeneralSectionProps = {
  data: SettingsBackend["general"];
  preferences: SettingsBackend["generalPreferences"] & {
    hostname: string;
    timezone: string;
  };
  capabilities: SettingsBackend["capabilities"]["general"];
  languageValue: string;
  languageOptions: string[];
  timeFormatValue: string;
  timeFormatOptions: string[];
  onHostnameChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onTimeFormatChange: (value: string) => void;
};

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("truncate text-right text-xs font-medium text-foreground", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}

function HardwareRow({
  icon,
  label,
  value,
  iconClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  iconClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg border border-glass-border bg-background/55", iconClass)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">{label}</div>
        <div className="truncate text-xs font-medium text-foreground">{value}</div>
      </div>
    </div>
  );
}

function PreferenceRow({
  label,
  description,
  disabled,
  children,
}: {
  label: string;
  description?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(SETTINGS_PANEL_INSET, "flex items-center justify-between gap-4 px-4 py-3", disabled && "opacity-50")}>
      <div className="min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-[11px] text-muted-foreground/70">{description}</div>}
      </div>
      {children}
    </div>
  );
}

export function GeneralSection({
  data,
  preferences,
  capabilities,
  languageValue,
  languageOptions,
  timeFormatValue,
  timeFormatOptions,
  onHostnameChange,
  onTimezoneChange,
  onLanguageChange,
  onTimeFormatChange,
}: GeneralSectionProps) {
  return (
    <div className="flex flex-col gap-1">
      {data.warning ? (
        <InfoBanner text={data.warning} variant={data.unavailable ? "warning" : "info"} />
      ) : null}

      {/* ── System Info ── */}
      <SectionDivider title="System Info" />
      <div className={cn(SETTINGS_PANEL_INSET, "divide-y divide-glass-border/50 px-4")}>
        <InfoRow label="Hostname" value={data.hostname} />
        <InfoRow label="OS" value={data.platform} />
        <InfoRow label="Kernel" value={data.kernel} mono />
        <InfoRow label="Architecture" value={data.architecture} />
        <InfoRow label="Uptime" value={data.uptime} />
        <InfoRow label="Homeio Version" value={data.appVersion} />
      </div>

      {/* ── Hardware ── */}
      <SectionDivider title="Hardware" />
      <div className={cn(SETTINGS_PANEL_INSET, "divide-y divide-glass-border/50 px-4")}>
        <HardwareRow
          icon={<Cpu className="size-3.5 text-primary" />}
          label="Processor"
          value={data.cpuSummary}
        />
        <HardwareRow
          icon={<MemoryStick className="size-3.5 text-primary" />}
          label="Memory"
          value={data.memorySummary}
        />
        <HardwareRow
          icon={<Thermometer className="size-3.5 text-status-amber" />}
          label="CPU Temperature"
          value={data.temperatureSummary}
        />
        <HardwareRow
          icon={<MonitorSpeaker className="size-3.5 text-primary" />}
          label="User"
          value={`${data.username} (${data.processUptime})`}
        />
      </div>

      {/* ── Preferences ── */}
      <SectionDivider title="Preferences" />
      {preferences.error ? (
        <InfoBanner text={preferences.error} variant="warning" />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <PreferenceRow
          label="Hostname"
          description="Applies immediately with hostnamectl."
          disabled={capabilities.hostname.disabled}
        >
          <input
            value={preferences.hostname}
            onChange={(e) => onHostnameChange(e.target.value)}
            disabled={capabilities.hostname.disabled}
            className="h-8 w-44 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground placeholder:text-muted-foreground/60 transition-all focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed"
          />
        </PreferenceRow>

        <PreferenceRow
          label="Timezone"
          description="Applies immediately with timedatectl."
          disabled={capabilities.timezone.disabled}
        >
          <select
            value={preferences.timezone}
            onChange={(e) => onTimezoneChange(e.target.value)}
            disabled={capabilities.timezone.disabled}
            className="h-8 w-44 cursor-pointer appearance-none rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground transition-all focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed"
          >
            {preferences.timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </PreferenceRow>

        <PreferenceRow
          label="Language"
          description="Saved locally for Homeio UI only."
          disabled={capabilities.language.disabled}
        >
          <select
            value={languageValue}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={capabilities.language.disabled}
            className="h-8 w-44 cursor-pointer appearance-none rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground transition-all focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed"
          >
            {languageOptions.map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
        </PreferenceRow>

        <PreferenceRow
          label="Time format"
          description="Status bar and lock screen clock."
          disabled={capabilities.language.disabled}
        >
          <select
            value={timeFormatValue}
            onChange={(e) => onTimeFormatChange(e.target.value)}
            disabled={capabilities.language.disabled}
            className="h-8 w-44 cursor-pointer appearance-none rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground transition-all focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed"
          >
            {timeFormatOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </PreferenceRow>
      </div>
    </div>
  );
}
