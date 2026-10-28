"use client";

import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import {
  useActiveSettingsSection,
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
import { cn } from "@/lib/utils";

const SIDEBAR_GROUPS: { label: string; ids: SettingsSectionId[] }[] = [
  { label: "System",         ids: ["general", "appearance", "updates"] },
  { label: "Infrastructure", ids: ["network", "storage", "docker"] },
  { label: "Integrations",  ids: ["integrations"] },
  { label: "Automation",     ids: ["scheduled-tasks", "backup"] },
  { label: "Access",         ids: ["users", "security", "notifications"] },
  { label: "Danger Zone",    ids: ["power", "advanced"] },
  { label: "Project",        ids: ["about"] },
];

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
    SETTINGS_SECTIONS.map((section) => section.id),
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

  return (
    <div className="flex h-full">
      <aside className={cn("m-2 flex w-52 shrink-0 flex-col", SETTINGS_PANEL_SHELL)}>
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

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">
              {activeDefinition.label}
            </h2>
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
