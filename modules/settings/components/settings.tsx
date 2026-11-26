"use client";

import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import {
  useBackupSettingsController,
  useGeneralSettingsController,
  useNotificationSettingsController,
  useSecuritySettingsController,
  useUpdatesAutoCheckEffect,
} from "@/modules/settings/components/panel/controllers";
import {
  buildSettingsSectionDefinitions,
  SETTINGS_SECTIONS,
} from "@/modules/settings/components/panel/registry";
import {
  SETTINGS_BADGE_SURFACE,
  SETTINGS_PANEL_SHELL,
} from "@/modules/settings/components/panel/surface";
import type { SettingsPanelProps, SettingsSectionId } from "@/modules/settings/components/panel/types";
import { useSettingsBackend } from "@/modules/settings/hooks/useSettingsBackend";
import { useMobileWindowPage } from "@/components/ui/mobile-window-page";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, ChevronRight } from "@/components/icons/platform-icons";
import { useCallback, useState } from "react";

const SIDEBAR_GROUPS: { label: string; ids: SettingsSectionId[] }[] = [
  { label: "System",         ids: ["general", "appearance", "updates"] },
  { label: "Infrastructure", ids: ["network", "storage", "docker"] },
  { label: "Integrations",  ids: ["integrations"] },
  { label: "Automation",     ids: ["scheduled-tasks", "backup"] },
  { label: "Access",         ids: ["users", "security", "notifications"] },
  { label: "Danger Zone",    ids: ["power", "advanced"] },
  { label: "Project",        ids: ["about"] },
];

function settingsNavigation(request: SettingsPanelProps["sectionRequest"]) {
  const section = SETTINGS_SECTIONS.find(({ id }) => id === request?.id);
  return { request, activeSection: section?.id ?? "general" as const, showingIndex: !section };
}

export function SettingsPanel({
  appearance,
  wallpaperOptions,
  accentOptions,
  onAppearanceChange,
  wallpaperAccentColor,
  sectionRequest,
  onOpenDiskManager,
}: SettingsPanelProps) {
  const [navigation, setNavigation] = useState(() => settingsNavigation(sectionRequest));
  if (navigation.request !== sectionRequest) setNavigation(settingsNavigation(sectionRequest));
  const { activeSection, showingIndex } = navigation;
  const showIndex = useCallback(() => setNavigation((current) => ({ ...current, showingIndex: true })), []);
  const setActiveSection = (section: SettingsSectionId) => setNavigation((current) => ({ ...current, activeSection: section, showingIndex: false }));
  const settingsBackend = useSettingsBackend();
  const desktopPreferences = useDesktopPreferences();

  const generalController = useGeneralSettingsController(
    settingsBackend.generalPreferences,
    settingsBackend.actions.saveGeneralPreferences,
  );
  const securityController = useSecuritySettingsController(
    settingsBackend.security,
    settingsBackend.actions.saveSecuritySettings,
  );
  const backupController = useBackupSettingsController(
    settingsBackend.backup.settings,
    settingsBackend.actions.saveBackupSettings,
  );
  const notificationController =
    useNotificationSettingsController(desktopPreferences);

  useUpdatesAutoCheckEffect({
    activeSection,
    isHydrated: desktopPreferences.isHydrated,
    autoCheckEnabled: desktopPreferences.preferences.autoCheckUpdates,
    onCheckForUpdates: settingsBackend.actions.checkForUpdates,
  });

  const sectionDefinitions = buildSettingsSectionDefinitions({
    appearance,
    wallpaperOptions,
    accentOptions,
    onAppearanceChange,
    wallpaperAccentColor,
    desktopPreferences,
    settingsBackend,
    generalController,
    securityController,
    notificationController,
    backupController,
    onOpenDiskManager,
  });
  const activeDefinition =
    sectionDefinitions.find((section) => section.id === activeSection) ??
    sectionDefinitions[0];
  const usesWindowTitle = useMobileWindowPage(showingIndex ? null : activeDefinition.label, showIndex);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col md:flex-row handheld:@container/mobile-settings handheld:!flex-col">
      <nav aria-label="Settings sections" className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--mobile-gutter)] pb-5 pt-3 md:hidden handheld:!block handheld:@xl/mobile-settings:!grid handheld:@xl/mobile-settings:grid-cols-2 handheld:@xl/mobile-settings:content-start handheld:@xl/mobile-settings:gap-x-4", !showingIndex && "handheld:!hidden handheld:@xl/mobile-settings:!hidden hidden")}>
        {SIDEBAR_GROUPS.map((group) => {
          const sections = sectionDefinitions.filter((section) => group.ids.includes(section.id as SettingsSectionId));
          if (!sections.length) return null;
          return (
            <section key={group.label} className="mb-4">
              <h3 className="mb-2 px-1 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{group.label}</h3>
              <div className="mobile-list-group divide-y divide-[var(--mobile-divider)]">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    aria-label={`Open ${section.label} settings`}
                    aria-current={activeSection === section.id ? "page" : undefined}
                    onClick={() => setActiveSection(section.id)}
                    className={cn("flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm text-foreground transition-colors hover:bg-secondary/50 active:bg-foreground/10 focus-visible:outline-primary", activeSection === section.id && "bg-primary/10 font-semibold")}
                  >
                    <section.icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{section.label}</span>
                    {section.badge ? <span className="text-xs font-semibold text-primary">{section.badge}</span> : null}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </nav>
      <aside aria-label="Settings sidebar" className={cn("m-2 hidden w-52 shrink-0 flex-col md:flex handheld:!hidden", SETTINGS_PANEL_SHELL)}>
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {SIDEBAR_GROUPS.map((group) => {
            const sections = sectionDefinitions.filter((s) => group.ids.includes(s.id as SettingsSectionId));
            if (sections.length === 0) return null;
            return (
              <div key={group.label} className="mb-3">
                <div className={cn(
                  "mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em]",
                  group.label === "Danger Zone" ? "text-status-red/60" : "text-muted-foreground/50",
                )}>
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {sections.map((section) => {
                    const isActive = activeSection === section.id;
                    return (
                      <button
                        key={section.id}
                        onClick={() => setActiveSection(section.id)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-primary/15 text-foreground"
                            : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                        )}
                      >
                        <section.icon
                          className={cn("size-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground/60")}
                        />
                        <span className="flex-1 truncate text-left text-[13px] font-medium">
                          {section.label}
                        </span>
                        {section.badge && (
                          <span className={cn(SETTINGS_BADGE_SURFACE, "flex size-5 items-center justify-center text-xs font-bold text-primary")}>
                            {section.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-glass-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="size-1.5 rounded-full bg-status-green" />
            <span className="text-xs font-medium text-muted-foreground">
              {settingsBackend.general.hostname}
            </span>
          </div>
          <span className="mt-0.5 block text-[11px] text-muted-foreground/60">
            {settingsBackend.general.appVersion} · {settingsBackend.general.platform}
          </span>
        </div>
      </aside>

      <main className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto md:block", showingIndex && "hidden handheld:!hidden")}>
        <div className="min-w-0 max-w-2xl p-4 md:p-5 handheld:mx-auto handheld:!px-[var(--mobile-gutter)] handheld:!py-4">
          {!usesWindowTitle && <button type="button" onClick={showIndex} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary transition-colors hover:text-primary/80 active:bg-foreground/10 focus-visible:outline-primary md:hidden handheld:!inline-flex handheld:min-h-[var(--mobile-touch-target)]">
            <ChevronLeftIcon className="size-4" aria-hidden="true" /> All settings
          </button>}
          <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-3 md:mb-4 handheld:!mb-3", usesWindowTitle && "empty:hidden") }>
            {!usesWindowTitle && <h2 className="text-base font-semibold text-foreground">
              {activeDefinition.label}
            </h2>}
            {!activeDefinition.liveApply && activeDefinition.save ? (
              <button
                className="min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg md:min-h-0 handheld:!min-h-11 bg-primary text-primary-foreground transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-primary/90"
                disabled={!activeDefinition.save.canSave}
                title={activeDefinition.save.title}
                onClick={() => {
                  void activeDefinition.save?.onSave?.();
                }}
              >
                {activeDefinition.save.pending
                  ? (activeDefinition.save.label ?? "Saving...")
                  : (activeDefinition.save.label ?? "Save Changes")}
              </button>
            ) : null}
          </div>
          {activeDefinition.render()}
        </div>
      </main>
    </div>
  );
}
