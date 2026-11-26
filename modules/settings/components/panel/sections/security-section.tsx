"use client";

import {
  InfoBanner,
  SectionDivider,
  Toggle,
} from "@/modules/settings/components/panel/controls";
import { SETTINGS_PANEL_INSET } from "@/modules/settings/components/panel/surface";
import type {
  SecuritySettingsDraft,
  SettingsBackend,
} from "@/modules/settings/components/panel/types";
import type { SystemSecurityPolicy } from "@/lib/shared/contracts/system";
import { Lock } from "@/components/icons/platform-icons";
import { cn } from "@/lib/utils";

type SecuritySectionProps = {
  data: SettingsBackend["security"];
  draft: SecuritySettingsDraft;
  isDemoMode?: boolean;
  onChange: (patch: Partial<SecuritySettingsDraft>) => void;
};

const selectCls =
  "h-8 w-36 cursor-pointer appearance-none rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

function PreferenceRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(SETTINGS_PANEL_INSET, "flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:gap-4")}>
      <div className="min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] text-muted-foreground/70">{description}</div>
        )}
      </div>
      {children}
    </div>
  );
}

export function SecuritySection({
  data,
  draft,
  isDemoMode = false,
  onChange,
}: SecuritySectionProps) {
  const isDisabled = isDemoMode || data.isLoading || data.isSaving;

  if (isDemoMode) {
    return (
      <div className="flex flex-col gap-1">
        <div className={cn(SETTINGS_PANEL_INSET, "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center")}>
          <div className="flex size-9 items-center justify-center rounded-lg border border-glass-border bg-background/55">
            <Lock className="size-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Security settings are locked</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Firewall and intrusion prevention controls are disabled in demo mode.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {data.error && (
        <InfoBanner text={data.error} variant={data.unavailable ? "warning" : "info"} />
      )}

      {/* ── Firewall ── */}
      <SectionDivider title="Firewall" />
      <div className="flex flex-col gap-1.5">
        <div className={cn(SETTINGS_PANEL_INSET, "px-4 py-1")}>
          <Toggle
            label="UFW Firewall"
            description="Uncomplicated Firewall for managing inbound and outbound rules"
            enabled={draft.firewallEnabled}
            onToggle={() => onChange({ firewallEnabled: !draft.firewallEnabled })}
            disabled={isDisabled}
          />
        </div>

        <PreferenceRow label="Default incoming policy" description="Action for unsolicited inbound connections">
          <select
            value={draft.firewallIncomingPolicy}
            onChange={(e) => onChange({ firewallIncomingPolicy: e.target.value as SystemSecurityPolicy })}
            disabled={isDisabled}
            className={selectCls}
          >
            {data.firewall.policyOptions.map((opt) => (
              <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
            ))}
          </select>
        </PreferenceRow>

        <PreferenceRow label="Default outgoing policy" description="Action for unsolicited outbound connections">
          <select
            value={draft.firewallOutgoingPolicy}
            onChange={(e) => onChange({ firewallOutgoingPolicy: e.target.value as SystemSecurityPolicy })}
            disabled={isDisabled}
            className={selectCls}
          >
            {data.firewall.policyOptions.map((opt) => (
              <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
            ))}
          </select>
        </PreferenceRow>
      </div>

      {/* ── Intrusion Prevention ── */}
      <SectionDivider title="Intrusion Prevention" />
      <div className="flex flex-col gap-1.5">
        <div className={cn(SETTINGS_PANEL_INSET, "px-4 py-1")}>
          <Toggle
            label="Fail2Ban"
            description="Automatically ban IPs with repeated failed login attempts"
            enabled={draft.fail2banEnabled}
            onToggle={() => onChange({ fail2banEnabled: !draft.fail2banEnabled })}
            disabled={isDisabled}
          />
        </div>

        <PreferenceRow label="Max retries" description="Failed attempts before banning an IP">
          <input
            value={draft.fail2banMaxRetries}
            onChange={(e) => onChange({ fail2banMaxRetries: e.target.value })}
            type="number"
            min={1}
            disabled={isDisabled}
            className="h-8 w-36 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </PreferenceRow>

        <PreferenceRow label="Ban duration" description="Seconds to keep the IP blocked (3600 = 1 hr)">
          <input
            value={draft.fail2banBanDurationSeconds}
            onChange={(e) => onChange({ fail2banBanDurationSeconds: e.target.value })}
            type="number"
            min={60}
            disabled={isDisabled}
            className="h-8 w-36 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </PreferenceRow>
      </div>
    </div>
  );
}
