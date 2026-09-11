"use client";

import { Slider } from "@/components/ui/slider";
import type {
  AccentColorOption,
  AppearanceSettings,
  RadiusPreset,
  WallpaperOption,
} from "@/lib/desktop/appearance";
import {
  APPEARANCE_RADIUS_MAX,
  APPEARANCE_RADIUS_MIN,
  RADIUS_PRESETS,
} from "@/lib/desktop/appearance";
import { SectionDivider, Toggle } from "@/modules/settings/components/panel/controls";
import {
  SETTINGS_BADGE_SURFACE,
  SETTINGS_PANEL_INSET,
} from "@/modules/settings/components/panel/surface";
import { Check } from "@/components/icons/platform-icons";
import { cn } from "@/lib/utils";
import { AUTO_ACCENT_VALUE } from "@/lib/desktop/appearance";

type AppearanceSectionProps = {
  appearance: AppearanceSettings;
  wallpaperOptions: WallpaperOption[];
  accentOptions: AccentColorOption[];
  onAppearanceChange: (patch: Partial<AppearanceSettings>) => void;
  wallpaperAccentColor: string | null;
};

// ── Segmented control ────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-glass-border bg-background/40 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-all cursor-pointer",
            value === opt.value
              ? "bg-background/80 text-foreground shadow-sm border border-glass-border"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Row wrapper for Display controls ────────────────────────────────────────

function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(SETTINGS_PANEL_INSET, "flex items-center justify-between gap-4 px-4 py-3")}>
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}

// ── Theme mini-preview ───────────────────────────────────────────────────────

function ThemePreview({ theme }: { theme: "dark" | "light" }) {
  const isDark = theme === "dark";
  const bg = isDark ? "oklch(0.13 0.015 250)" : "oklch(0.96 0.005 250)";
  const sidebar = isDark ? "oklch(0.10 0.012 250 / 0.8)" : "oklch(0.90 0.008 250 / 0.8)";
  const card = isDark ? "oklch(0.17 0.015 250 / 0.7)" : "oklch(0.99 0.004 250 / 0.7)";
  const line1 = isDark ? "bg-white/20" : "bg-black/15";
  const line2 = isDark ? "bg-white/10" : "bg-black/8";
  const dot = isDark ? "bg-white/30" : "bg-black/20";

  return (
    <div
      className="h-16 w-full overflow-hidden rounded-[calc(var(--radius)+0.125rem)] border border-glass-border/60"
      style={{ background: bg }}
    >
      <div className="flex h-full gap-0">
        {/* Sidebar strip */}
        <div className="flex w-10 flex-col gap-1.5 p-1.5" style={{ background: sidebar }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} className={cn("h-1.5 w-full rounded-full", i === 0 ? line1 : line2)} />
          ))}
        </div>
        {/* Content */}
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <div className="flex gap-1.5">
            <div
              className="flex-1 rounded-md p-1.5"
              style={{ background: card }}
            >
              <div className={cn("mb-1 h-1 w-8 rounded-full", line1)} />
              <div className={cn("h-1 w-5 rounded-full", line2)} />
            </div>
            <div
              className="flex-1 rounded-md p-1.5"
              style={{ background: card }}
            >
              <div className={cn("mb-1 h-1 w-6 rounded-full", line1)} />
              <div className={cn("h-1 w-4 rounded-full", line2)} />
            </div>
          </div>
          <div className="flex gap-1">
            {[...Array(3)].map((_, i) => (
              <div key={i} className={cn("size-2.5 rounded-sm", dot)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function AppearanceSection({
  appearance,
  wallpaperOptions,
  accentOptions,
  onAppearanceChange,
  wallpaperAccentColor,
}: AppearanceSectionProps) {
  const radiusPresets: RadiusPreset[] = RADIUS_PRESETS;

  const themeOptions: { name: string; value: AppearanceSettings["theme"] }[] = [
    { name: "Dark", value: "dark" },
    { name: "Light", value: "light" },
  ];

  return (
    <div className="flex flex-col gap-1">

      {/* ── Theme ── */}
      <SectionDivider title="Theme" />
      <div
        data-testid="theme-scroller"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-glass-border"
      >
        {themeOptions.map((theme) => {
          const active = appearance.theme === theme.value;
          return (
            <button
              key={theme.value}
              type="button"
              title={theme.name}
              onClick={() => onAppearanceChange({ theme: theme.value })}
              className={cn(
                "flex w-44 shrink-0 flex-col gap-2 rounded-[calc(var(--radius)+0.375rem)] border p-2.5 text-left transition-all cursor-pointer",
                active
                  ? "border-primary bg-primary/10 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_28%,transparent)]"
                  : "border-glass-border bg-background/46 hover:border-foreground/20 hover:bg-background/68",
              )}
            >
              <ThemePreview theme={theme.value as "dark" | "light"} />
              <div className="flex items-center justify-between gap-2 px-0.5">
                <span className={cn("text-xs font-medium", active ? "text-primary" : "text-muted-foreground")}>
                  {theme.name}
                </span>
                {active && (
                  <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-2.5" />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Accent Color ── */}
      <SectionDivider title="Accent Color" />
      <div className={cn(SETTINGS_PANEL_INSET, "p-3")}>
        <div
          data-testid="accent-scroller"
          className="-mx-1 flex gap-2.5 overflow-x-auto px-1 py-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-glass-border"
        >
          {/* Auto option — derives color from wallpaper */}
          {(() => {
            const active = appearance.accentColor === AUTO_ACCENT_VALUE;
            const previewColor = wallpaperAccentColor ?? "oklch(0.65 0.2 250)";
            return (
              <button
                type="button"
                title="Auto (from wallpaper)"
                onClick={() => onAppearanceChange({ accentColor: AUTO_ACCENT_VALUE })}
                className={cn(
                  "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-all overflow-hidden",
                  active
                    ? "border-foreground/60 scale-110 shadow-md"
                    : "border-transparent hover:scale-105 hover:border-foreground/20",
                )}
                style={{ background: `conic-gradient(${previewColor} 0deg, oklch(0.5 0.1 180) 120deg, oklch(0.6 0.15 300) 240deg, ${previewColor} 360deg)` }}
              >
                {active && <Check className="size-3.5 text-white drop-shadow-sm" />}
              </button>
            );
          })()}

          {accentOptions.map((color) => {
            const active = appearance.accentColor === color.value;
            return (
              <button
                key={color.name}
                type="button"
                title={color.name}
                onClick={() => onAppearanceChange({ accentColor: color.value })}
                className={cn(
                  "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-all",
                  active
                    ? "border-foreground/60 scale-110 shadow-md"
                    : "border-transparent hover:scale-105 hover:border-foreground/20",
                )}
                style={{ backgroundColor: color.value }}
              >
                {active && <Check className="size-3.5 text-white drop-shadow-sm" />}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 text-2xs text-muted-foreground/60">
          {appearance.accentColor === AUTO_ACCENT_VALUE
            ? "Auto — from wallpaper"
            : (accentOptions.find((c) => c.value === appearance.accentColor)?.name ?? "Custom")}
        </p>
      </div>

      {/* ── Wallpaper ── */}
      <SectionDivider title="Wallpaper" />
      <div
        data-testid="wallpaper-scroller"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 py-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-glass-border"
      >
        {wallpaperOptions.map((wallpaper) => {
          const active = appearance.wallpaper === wallpaper.src;
          return (
            <button
              key={wallpaper.id}
              type="button"
              title={wallpaper.name}
              // The desktop waits for the image before it fades, so warming it
              // on hover turns the click from "nothing happened" into instant.
              onMouseEnter={() => {
                const warm = new Image();
                warm.decoding = "async";
                warm.src = wallpaper.src;
              }}
              onClick={() => onAppearanceChange({ wallpaper: wallpaper.src })}
              className={cn(
                "relative h-14 w-24 shrink-0 overflow-hidden rounded-xl border-2 transition-all cursor-pointer",
                active
                  ? "border-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_40%,transparent)]"
                  : "border-transparent hover:border-foreground/25",
              )}
            >
              <div
                className="h-full w-full bg-cover bg-center"
                style={{ backgroundImage: `url('${wallpaper.src}')` }}
              />
            </button>
          );
        })}
      </div>

      {/* ── Shape ── */}
      <SectionDivider title="Shape" />
      <div className={cn(SETTINGS_PANEL_INSET, "px-4 py-3")}>
        <div className="flex items-center gap-3">
          {/* Live preview */}
          <div
            className="h-8 w-16 shrink-0 border border-glass-border bg-primary/10 transition-all"
            style={{ borderRadius: appearance.radius }}
          />
          {/* Slider + badge */}
          <div className="flex flex-1 items-center gap-2">
            <div className="flex-1">
              <Slider
                aria-label="Corner radius"
                min={APPEARANCE_RADIUS_MIN}
                max={APPEARANCE_RADIUS_MAX}
                step={1}
                value={[appearance.radius]}
                onValueChange={(values) => {
                  const next = values[0];
                  if (next === undefined) return;
                  onAppearanceChange({ radius: next });
                }}
              />
            </div>
            <span className={cn(SETTINGS_BADGE_SURFACE, "inline-flex w-10 items-center justify-center px-2 py-1 text-xs font-medium text-primary")}>
              {appearance.radius}px
            </span>
          </div>
        </div>
        {/* Preset swatches */}
        <div className="mt-3 flex gap-2">
          {radiusPresets.map((preset) => {
            const active = appearance.radius === preset.value;
            return (
              <button
                key={preset.name}
                type="button"
                aria-label={`Set ${preset.name} radius`}
                onClick={() => onAppearanceChange({ radius: preset.value })}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 transition-all cursor-pointer",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-glass-border bg-background/40 hover:border-foreground/20",
                )}
              >
                <div
                  className={cn("h-4 w-6 shrink-0 border", active ? "border-primary bg-primary/20" : "border-glass-border bg-background/60")}
                  style={{ borderRadius: preset.value }}
                />
                <span className={cn("text-2xs font-medium", active ? "text-primary" : "text-muted-foreground")}>
                  {preset.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Liquid Glass ── */}
      <SectionDivider title="Liquid Glass" />
      <div className={cn(SETTINGS_PANEL_INSET, "p-4")}>
        <p className="mb-3 text-xs text-muted-foreground">
          Choose the look of glass surfaces across the interface.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {(["clear", "tinted"] as const).map((style) => {
            const active = appearance.glassStyle === style;
            return (
              <button
                key={style}
                type="button"
                onClick={() => onAppearanceChange({ glassStyle: style })}
                className={cn(
                  "flex flex-col gap-2 rounded-[calc(var(--radius)+0.375rem)] border p-2.5 text-left transition-all cursor-pointer",
                  active
                    ? "border-primary bg-primary/10 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_28%,transparent)]"
                    : "border-glass-border bg-background/46 hover:border-foreground/20 hover:bg-background/68",
                )}
              >
                <div
                  className="h-14 w-full overflow-hidden rounded-[calc(var(--radius)+0.125rem)] border border-white/[0.09]"
                  style={{
                    background:
                      style === "clear"
                        ? "oklch(0.14 0.015 250 / 0.18)"
                        : "oklch(0.04 0.006 250 / 0.75)",
                    backdropFilter: "blur(12px) saturate(160%)",
                  }}
                >
                  <div className="flex flex-col gap-1.5 p-2">
                    <div className="flex gap-1">
                      <div className="h-2 w-7 rounded-full bg-white/25" />
                      <div className="h-2 w-4 rounded-full bg-white/15" />
                    </div>
                    <div className="flex gap-1">
                      <div className="h-2 w-4 rounded-full bg-white/15" />
                      <div className="h-2 w-6 rounded-full bg-white/10" />
                    </div>
                    <div className="mt-0.5 flex gap-1">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="size-3 rounded-md bg-white/12" />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <span className={cn("text-xs font-medium", active ? "text-primary" : "text-muted-foreground")}>
                    {style === "clear" ? "Clear" : "Tinted"}
                  </span>
                  {active && (
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-2.5" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Display ── */}
      <SectionDivider title="Display" />
      <div className="flex flex-col gap-1.5">
        <ControlRow label="Icon size">
          <SegmentedControl
            value={appearance.iconSize}
            options={[
              { label: "Small", value: "small" as const },
              { label: "Medium", value: "medium" as const },
              { label: "Large", value: "large" as const },
            ]}
            onChange={(v) => onAppearanceChange({ iconSize: v })}
          />
        </ControlRow>

        <ControlRow label="Font size">
          <SegmentedControl
            value={appearance.fontSize}
            options={[
              { label: "Compact", value: "compact" as const },
              { label: "Default", value: "default" as const },
              { label: "Large", value: "large" as const },
              { label: "XL", value: "extra-large" as const },
            ]}
            onChange={(v) => onAppearanceChange({ fontSize: v })}
          />
        </ControlRow>

        <ControlRow label="Dock position">
          <SegmentedControl
            value={appearance.dockPosition}
            options={[
              { label: "Bottom", value: "bottom" as const },
              { label: "Left", value: "left" as const },
              { label: "Right", value: "right" as const },
            ]}
            onChange={(v) => onAppearanceChange({ dockPosition: v })}
          />
        </ControlRow>

        <div className={cn(SETTINGS_PANEL_INSET, "px-4 py-1")}>
          <Toggle
            label="Animations"
            description="Enable smooth transitions and hover effects"
            enabled={appearance.animationsEnabled}
            onToggle={() => onAppearanceChange({ animationsEnabled: !appearance.animationsEnabled })}
          />
        </div>
      </div>

    </div>
  );
}
