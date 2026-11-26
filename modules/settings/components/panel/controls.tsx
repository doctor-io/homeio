"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Info,
} from "@/components/icons/platform-icons";
import { SETTINGS_BADGE_SURFACE } from "@/modules/settings/components/panel/surface";
import type { ControlAvailability } from "@/modules/settings/components/panel/types";
import {
  createContext,
  useContext,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

const ControlAvailabilityContext = createContext<ControlAvailability>({
  disabled: false,
});

export function ControlAvailabilityProvider({
  value,
  children,
}: {
  value: ControlAvailability;
  children: ReactNode;
}) {
  return (
    <ControlAvailabilityContext.Provider value={value}>
      {children}
    </ControlAvailabilityContext.Provider>
  );
}

export function useControlAvailability(
  overrideDisabled?: boolean,
  overrideReason?: string,
) {
  const context = useContext(ControlAvailabilityContext);
  const disabled =
    overrideDisabled !== undefined
      ? overrideDisabled
      : Boolean(context.disabled);

  const disabledReason =
    overrideReason !== undefined
      ? overrideReason
      : disabled
        ? context.disabledReason
        : undefined;

  return {
    disabled,
    disabledReason,
  };
}

export function ControlDisabledHint({ text }: { text?: string }) {
  if (!text) return null;
  return <span className="text-xs text-status-amber">{text}</span>;
}

export function Toggle({
  enabled,
  onToggle,
  label,
  description,
  disabled,
  disabledReason,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const availability = useControlAvailability(disabled, disabledReason);

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-foreground">{label}</span>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
        <ControlDisabledHint text={availability.disabledReason} />
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${label}`}
        onClick={availability.disabled ? undefined : onToggle}
        disabled={availability.disabled}
        className={`relative inline-flex h-5 w-10 shrink-0 items-center before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] md:before:inset-y-0 handheld:before:!-inset-y-3 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
          availability.disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer"
        } ${enabled ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span
          className={`pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsInput({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
  readOnly,
  copyable,
  description,
  disabled,
  disabledReason,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  copyable?: boolean;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const isPassword = type === "password";
  const availability = useControlAvailability(disabled, disabledReason);
  const isReadOnly = readOnly || availability.disabled || !onChange;

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {description ? (
        <span className="text-xs text-muted-foreground/70">{description}</span>
      ) : null}
      <ControlDisabledHint text={availability.disabledReason} />
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type={isPassword && !showPassword ? "password" : "text"}
            value={value}
            placeholder={placeholder}
            readOnly={isReadOnly}
            disabled={availability.disabled}
            onChange={(event) => {
              if (!onChange || isReadOnly || availability.disabled) return;
              onChange(event.target.value);
            }}
            className={`min-h-11 w-full rounded-lg md:min-h-0 md:h-8 handheld:!min-h-11 border border-glass-border bg-background/55 px-3 text-xs text-foreground placeholder:text-muted-foreground/60 transition-all focus:border-primary/40 focus:outline-none read-only:opacity-60 disabled:cursor-not-allowed disabled:opacity-50 ${isPassword ? "handheld:pr-12" : ""}`}
          />
          {isPassword ? (
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword(!showPassword)}
              className={`absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground handheld:!right-0 handheld:flex handheld:size-11 handheld:items-center handheld:justify-center ${
                availability.disabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:text-foreground"
              }`}
              disabled={availability.disabled}
            >
              {showPassword ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>
        {copyable ? (
          <button
            onClick={() => {
              navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            aria-label={copied ? "Copied" : `Copy ${label}`}
            className={`p-1.5 rounded-lg text-muted-foreground transition-colors handheld:flex handheld:size-11 handheld:shrink-0 handheld:items-center handheld:justify-center ${
              availability.disabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer hover:bg-secondary/50 hover:text-foreground"
            }`}
            disabled={availability.disabled}
          >
            {copied ? (
              <Check className="size-3.5 text-status-green" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsSelect({
  label,
  value,
  options,
  description,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  value: string;
  options: readonly string[];
  description?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const availability = useControlAvailability(disabled, disabledReason);

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {description ? (
        <span className="text-xs text-muted-foreground/70">{description}</span>
      ) : null}
      <ControlDisabledHint text={availability.disabledReason} />
      <select
        {...(onChange
          ? {
              value,
              onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                onChange(event.target.value),
            }
          : { value })}
        disabled={availability.disabled}
        className="min-h-11 w-full cursor-pointer appearance-none md:min-h-0 md:h-8 handheld:!min-h-11 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground transition-all focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SectionDivider({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-5 pb-2">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
        {title}
      </span>
      <div className="flex-1 h-px bg-glass-border" />
    </div>
  );
}

export function InfoBanner({
  text,
  variant = "info",
}: {
  text: string;
  variant?: "info" | "warning";
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl p-3 text-xs ${
        variant === "warning"
          ? "bg-status-amber/10 border border-status-amber/20 text-status-amber"
          : "bg-primary/8 border border-primary/15 text-primary"
      }`}
    >
      {variant === "warning" ? (
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
      ) : (
        <Info className="size-4 shrink-0 mt-0.5" />
      )}
      <span className="leading-relaxed">{text}</span>
    </div>
  );
}

export function StorageBar({
  label,
  detail,
  pct,
  color,
}: {
  label: string;
  detail: string;
  pct: number;
  color: string;
}) {
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(pct, 100)) : 0;

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-[var(--radius)] bg-background/65">
        <div
          className="h-full rounded-[var(--radius)] transition-all"
          style={{ width: `${safePct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function formatStorageSize(bytes: number | null | undefined) {
  if (
    bytes === null ||
    bytes === undefined ||
    !Number.isFinite(bytes) ||
    bytes < 0
  ) {
    return "--";
  }

  if (bytes < 1024 ** 2) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  if (bytes < 1024 ** 4) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
}

export function UserRow({
  name,
  role,
  email,
  lastActive,
  avatarColor,
}: {
  name: string;
  role: string;
  email: string;
  lastActive: string;
  avatarColor: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 group">
      <div
        className="size-8 rounded-[var(--radius)] flex items-center justify-center text-xs font-bold text-foreground shrink-0"
        style={{ backgroundColor: avatarColor }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">{name}</span>
          <span
            className={`${SETTINGS_BADGE_SURFACE} px-1.5 py-0.5 text-xs font-medium ${
              role === "Admin"
                ? "bg-primary/15 text-primary"
                : role === "Editor"
                  ? "bg-status-amber/15 text-status-amber"
                  : "bg-secondary text-muted-foreground"
            }`}
          >
            {role}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{email}</span>
      </div>
      <span className="text-xs text-muted-foreground hidden sm:block">
        {lastActive}
      </span>
      <button className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-secondary/50 transition-all text-muted-foreground cursor-pointer">
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}

export function BackupRow({
  date,
  size,
  type,
  status,
  actionLabel,
  onAction,
  actionDisabled,
}: {
  date: string;
  size: string;
  type: string;
  status: "completed" | "failed" | "in-progress";
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div
        className={`size-2 rounded-[var(--radius)] shrink-0 ${
          status === "completed"
            ? "bg-status-green"
            : status === "in-progress"
              ? "bg-status-amber animate-pulse"
              : "bg-status-red"
        }`}
      />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-foreground">{type}</span>
        <div className="text-xs text-muted-foreground">
          {date} - {size}
        </div>
      </div>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="cursor-pointer rounded-lg bg-background/55 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-background/75 enabled:hover:text-foreground"
          disabled={actionDisabled}
        >
          {actionLabel}
        </button>
      ) : (
        <button className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background/75 hover:text-foreground">
          <Download className="size-3.5" />
        </button>
      )}
    </div>
  );
}
