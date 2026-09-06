"use client";

import { ChevronLeftIcon as ChevronLeft, Star } from "@/components/icons/platform-icons";
import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import { cn } from "@/lib/utils";
import {
    useActiveSettingsSection,
    useBackupSettingsController,
    useGeneralSettingsController,
    useNotificationSettingsController,
    useSecuritySettingsController,
    useUpdatesAutoCheckEffect,
} from "@/modules/settings/components/panel/controllers";
import {
    SETTINGS_SECTION_GROUPS,
    SETTINGS_SECTION_IDS,
} from "@/modules/settings/components/panel/catalog";
import { buildSettingsSectionDefinitions } from "@/modules/settings/components/panel/registry";
import {
    SETTINGS_BADGE_SURFACE,
    SETTINGS_PANEL_SHELL,
} from "@/modules/settings/components/panel/surface";
import type { SettingsPanelProps } from "@/modules/settings/components/panel/types";
import { useSettingsBackend } from "@/modules/settings/hooks/useSettingsBackend";
import { useState } from "react";

export function SettingsPanel({
  appearance,
  wallpaperOptions,
  accentOptions,
  onAppearanceChange,
  wallpaperAccentColor,
  selectedSection,
  onOpenDiskManager,
}: SettingsPanelProps) {
  const settingsBackend = useSettingsBackend();
  const desktopPreferences = useDesktopPreferences();
  const { activeSection, setActiveSection } = useActiveSettingsSection(
    selectedSection,
    SETTINGS_SECTION_IDS,
  );

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

  // Which pane has the panel while it is too narrow for both. The switch
  // itself is CSS (see @container/settings below), so there is no width to
  // measure and no observer whose first reading can land before the window has
  // been sized.
  const [compactView, setCompactView] = useState<"nav" | "section">("nav");

  return (
    <div className="@container/settings flex h-full">
      <aside
        className={cn(
          "m-2 flex-col",
          SETTINGS_PANEL_SHELL,
          // Narrow: the list has the panel until a section is chosen.
          compactView === "nav" ? "flex w-full" : "hidden",
          // Wide: always a fixed column beside the section.
          "@2xl/settings:flex @2xl/settings:w-52 @2xl/settings:shrink-0",
        )}
      >
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {SETTINGS_SECTION_GROUPS.map((group) => {
            const sections = sectionDefinitions.filter(
              (section) => section.group === group.id,
            );
            if (sections.length === 0) return null;
            return (
              <div key={group.id} className="mb-3">
                <div
                  className={cn(
                    "mb-1 px-3 text-3xs font-semibold uppercase tracking-[0.16em]",
                    group.id === "danger"
                      ? "text-status-red/60"
                      : "text-muted-foreground/50",
                  )}
                >
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {sections.map((section) => {
                    const isActive = activeSection === section.id;
                    return (
                      <button
                        key={section.id}
                        onClick={() => {
                          setActiveSection(section.id);
                          setCompactView("section");
                        }}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-primary/15 text-foreground"
                            : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                        )}
                      >
                        <section.icon
                          className={cn(
                            "size-4 shrink-0",
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground/60",
                          )}
                        />
                        <span className="flex-1 truncate text-left text-sm font-medium">
                          {section.label}
                        </span>
                        {section.badge && (
                          <span
                            className={cn(
                              SETTINGS_BADGE_SURFACE,
                              "flex size-5 items-center justify-center text-xs font-bold text-primary",
                            )}
                          >
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-status-green" />
              <span className="text-xs font-medium text-muted-foreground">
                {settingsBackend.general.hostname}
              </span>
            </div>
            <a
              href="https://github.com/doctor-io/homeio"
              target="_blank"
              rel="noreferrer"
              title="Star Homeio on GitHub"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <Star className="size-3 text-amber-400" />
              <span>Star</span>
            </a>
          </div>
          <span className="mt-0.5 block text-2xs text-muted-foreground/60">
            {settingsBackend.general.appVersion} ·{" "}
            {settingsBackend.general.platform}
          </span>
        </div>
      </aside>

      <main
        className={cn(
          "flex-1 overflow-y-auto @2xl/settings:block",
          compactView === "section" ? "block" : "hidden",
        )}
      >
        <div className="max-w-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex min-w-0 items-center gap-2">
              {/* Only while the list is hidden — see @container/settings. */}
              <button
                type="button"
                onClick={() => setCompactView("nav")}
                aria-label="Back to settings list"
                className="-ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--system-radius-icon)] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground @2xl/settings:hidden"
              >
                <ChevronLeft className="size-4" />
              </button>
              <h2 className="truncate text-base font-semibold text-foreground">
                {activeDefinition.label}
              </h2>
            </div>
            {!activeDefinition.liveApply && activeDefinition.save ? (
              <button
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-primary/90"
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
