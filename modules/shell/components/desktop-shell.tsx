"use client";

import { Search } from "@/components/icons/platform-icons";
import { CurrentUserError, useCurrentUser } from "@/hooks/useCurrentUser";
import { readLockState, writeLockState } from "@/lib/desktop/lock-state";
import {
  clearPersistedPowerActionCompletion,
  readPersistedPowerActionCompletion,
} from "@/lib/desktop/reboot-state";
import {
  pushRecentCommandAction,
  readRecentCommandActions,
  type RecentCommandAction,
} from "@/lib/desktop/recent-actions";
import {
  AppGrid,
  type AppActionTarget,
} from "@/modules/apps/components/app-grid";
import { AppLogsDialog } from "@/modules/apps/components/app-logs-dialog";
import { AppStore } from "@/modules/apps/components/app-store";
import { AppConfiguratorPanel } from "@/modules/apps/components/configurator/app-configurator-panel";
import {
  StoreActionsProvider,
  useSharedStoreActions,
} from "@/modules/apps/hooks/StoreActionsContext";
import { FileManager } from "@/modules/files/components/file-manager";
import { SETTINGS_SECTIONS } from "@/modules/settings/components/panel/catalog";
import {
  DESKTOP_WINDOWS,
  DESKTOP_WINDOWS_BY_ID,
  type DesktopWindowId,
} from "@/modules/shell/app-catalog";
import { SettingsPanel } from "@/modules/settings/components/settings";
import { CommandPalette } from "@/modules/shell/components/command-palette";
import { useDesktopAppearance } from "@/modules/shell/hooks/useDesktopAppearance";
import { useRebootRecovery } from "@/modules/shell/hooks/useRebootRecovery";
import { Monitor } from "@/modules/system/components/monitor";
import { DiskManager } from "@/modules/system/components/disk-manager";
import { NotificationsPanel } from "@/modules/system/components/notifications-panel";
import { StatusBar } from "@/modules/system/components/status-bar";
import {
  DesktopTour,
  useDesktopTour,
} from "@/modules/shell/components/desktop-tour";
import { SystemWidgets } from "@/modules/system/components/system-widgets";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Dock } from "./dock";
import { LockScreen } from "./lock-screen";
import { RebootOverlay } from "./reboot-overlay";
import { SessionLoadingScreen } from "./session-loading-screen";
import { Terminal } from "./terminal";
import { UpdateRecoveryScreen } from "./update-recovery-screen";
import { Window } from "./window";

type DesktopWindowBody = {
  /** Extra condition beyond "is open" — app-settings needs a target first. */
  enabled?: boolean;
  /** Overrides the catalog title when it depends on runtime state. */
  title?: string;
  /** Overrides the default close handler when extra state must be cleared. */
  onClose?: () => void;
  render: () => React.ReactNode;
};

const WINDOW_CLOSE_ANIMATION_MS = 180;
const WALLPAPER_FADE_MS = 420;

export function DesktopShell() {
  return (
    <StoreActionsProvider>
      <DesktopShellInner />
    </StoreActionsProvider>
  );
}

function DesktopShellInner() {
  const router = useRouter();
  const tour = useDesktopTour();

  const {
    data: currentUser,
    error: currentUserError,
    isLoading: isLoadingUser,
    isError: isCurrentUserError,
  } = useCurrentUser();
  const [openWindows, setOpenWindows] = useState<string[]>([]);
  const [closingWindows, setClosingWindows] = useState<string[]>([]);
  const [minimizedWindows, setMinimizedWindows] = useState<string[]>([]);
  const [focusedWindow, setFocusedWindow] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isLockStateHydrated, setIsLockStateHydrated] = useState(false);
  const [isLogoutPending, setIsLogoutPending] = useState(false);
  const [isSettingsSearchOpen, setIsSettingsSearchOpen] = useState(false);
  const [settingsSearchQuery, setSettingsSearchQuery] = useState("");
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<
    string | null
  >(null);
  const [appStoreLaunchRequest, setAppStoreLaunchRequest] = useState<{
    nonce: number;
    search?: string;
    appId?: string;
  } | null>(null);
  const [recentActions, setRecentActions] = useState<RecentCommandAction[]>([]);
  const [terminalCommandRequest, setTerminalCommandRequest] = useState<{
    id: number;
    command: string;
  } | null>(null);
  const [terminalMode, setTerminalMode] = useState<"interactive" | "logs">(
    "interactive",
  );
  const [appSettingsTarget, setAppSettingsTarget] =
    useState<AppActionTarget | null>(null);
  const [logsTarget, setLogsTarget] = useState<AppActionTarget | null>(null);
  const shellStoreActions = useSharedStoreActions();
  const terminalCommandIdRef = useRef(0);
  const [displayWallpaper, setDisplayWallpaper] = useState("/images/1.jpg");
  const [nextWallpaper, setNextWallpaper] = useState<string | null>(null);
  const [isWallpaperFading, setIsWallpaperFading] = useState(false);
  const closeTimersRef = useRef<Record<string, number>>({});
  const wallpaperFinalizeTimerRef = useRef<number | null>(null);
  const wallpaperFrameRef = useRef<number | null>(null);
  const wallpaperTransitionIdRef = useRef(0);
  const appStoreLaunchNonceRef = useRef(0);
  const {
    appearance,
    updateAppearance,
    wallpapers,
    accentColors,
    appIconSize,
    wallpaperAccentColor,
  } = useDesktopAppearance();
  const rebootRecovery = useRebootRecovery();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRecentActions(readRecentCommandActions(window.localStorage));
  }, []);

  const setLockState = useCallback((value: boolean) => {
    setIsLocked(value);
    if (typeof window !== "undefined") {
      writeLockState(window.localStorage, value);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsLocked(readLockState(window.localStorage));
    setIsLockStateHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!rebootRecovery.isHydrated || rebootRecovery.isActive) return;

    const completion = readPersistedPowerActionCompletion(window.localStorage);
    if (!completion) return;

    clearPersistedPowerActionCompletion(window.localStorage);

    if (completion.action === "update") {
      toast.success("Homeio update completed.");
      return;
    }

    toast.success("System action completed.");
  }, [rebootRecovery.isActive, rebootRecovery.isHydrated]);

  useEffect(() => {
    if (rebootRecovery.isActive || !rebootRecovery.isHydrated) return;

    if (isCurrentUserError) {
      if (
        currentUserError instanceof CurrentUserError &&
        currentUserError.redirectTo
      ) {
        router.replace(currentUserError.redirectTo);
        return;
      }

      router.replace("/login");
    }
  }, [
    currentUserError,
    isCurrentUserError,
    rebootRecovery.isActive,
    rebootRecovery.isHydrated,
    router,
  ]);

  const filteredSettingsSections = useMemo(() => {
    const query = settingsSearchQuery.trim().toLowerCase();
    if (!query) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.filter((section) =>
      section.label.toLowerCase().includes(query),
    );
  }, [settingsSearchQuery]);

  const getNextFocusableWindow = useCallback(
    (excludedId?: string) => {
      const visibleWindows = openWindows.filter(
        (windowId) =>
          windowId !== excludedId &&
          !closingWindows.includes(windowId) &&
          !minimizedWindows.includes(windowId),
      );

      return visibleWindows.at(-1) ?? null;
    },
    [closingWindows, minimizedWindows, openWindows],
  );

  const finalizeCloseWindow = useCallback(
    (id: string) => {
      setOpenWindows((prev) => prev.filter((w) => w !== id));
      setClosingWindows((prev) => prev.filter((w) => w !== id));
      setMinimizedWindows((prev) => prev.filter((w) => w !== id));
      setFocusedWindow((prev) =>
        prev === id ? getNextFocusableWindow(id) : prev,
      );
    },
    [getNextFocusableWindow],
  );

  const openWindow = useCallback((id: string) => {
    if (closeTimersRef.current[id]) {
      window.clearTimeout(closeTimersRef.current[id]);
      delete closeTimersRef.current[id];
    }
    setClosingWindows((prev) => prev.filter((w) => w !== id));
    setMinimizedWindows((prev) => prev.filter((w) => w !== id));
    setOpenWindows((prev) => {
      if (prev.includes(id)) {
        // Already open, just focus it
        setFocusedWindow(id);
        return prev;
      }
      return [...prev, id];
    });
    setFocusedWindow(id);
  }, []);

  const minimizeWindow = useCallback(
    (id: string) => {
      setMinimizedWindows((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setFocusedWindow((prev) =>
        prev === id ? getNextFocusableWindow(id) : prev,
      );
    },
    [getNextFocusableWindow],
  );

  const closeWindow = useCallback(
    (id: string) => {
      if (closeTimersRef.current[id]) {
        window.clearTimeout(closeTimersRef.current[id]);
        delete closeTimersRef.current[id];
      }

      if (!appearance.animationsEnabled) {
        finalizeCloseWindow(id);
        return;
      }

      setClosingWindows((prev) => (prev.includes(id) ? prev : [...prev, id]));
      closeTimersRef.current[id] = window.setTimeout(() => {
        delete closeTimersRef.current[id];
        finalizeCloseWindow(id);
      }, WINDOW_CLOSE_ANIMATION_MS);
    },
    [appearance.animationsEnabled, finalizeCloseWindow],
  );

  useEffect(() => {
    setDisplayWallpaper(appearance.wallpaper);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (appearance.wallpaper === displayWallpaper) return;

    wallpaperTransitionIdRef.current += 1;
    const transitionId = wallpaperTransitionIdRef.current;

    if (wallpaperFinalizeTimerRef.current) {
      window.clearTimeout(wallpaperFinalizeTimerRef.current);
      wallpaperFinalizeTimerRef.current = null;
    }
    if (wallpaperFrameRef.current) {
      window.cancelAnimationFrame(wallpaperFrameRef.current);
      wallpaperFrameRef.current = null;
    }

    if (!appearance.animationsEnabled) {
      setDisplayWallpaper(appearance.wallpaper);
      setNextWallpaper(null);
      setIsWallpaperFading(false);
      return;
    }

    const targetWallpaper = appearance.wallpaper;

    const startFade = () => {
      if (transitionId !== wallpaperTransitionIdRef.current) return;
      setNextWallpaper(targetWallpaper);
      setIsWallpaperFading(false);
      wallpaperFrameRef.current = window.requestAnimationFrame(() => {
        if (transitionId !== wallpaperTransitionIdRef.current) return;
        setIsWallpaperFading(true);
        wallpaperFrameRef.current = null;
      });
      // Fallback finalize in case transitionend does not fire.
      wallpaperFinalizeTimerRef.current = window.setTimeout(() => {
        if (transitionId !== wallpaperTransitionIdRef.current) return;
        setDisplayWallpaper(targetWallpaper);
        setNextWallpaper(null);
        setIsWallpaperFading(false);
        wallpaperFinalizeTimerRef.current = null;
      }, WALLPAPER_FADE_MS + 80);
    };

    const preload = new Image();
    preload.decoding = "async";
    preload.src = targetWallpaper;
    if (preload.complete) {
      startFade();
    } else {
      preload.onload = startFade;
      preload.onerror = startFade;
    }
  }, [appearance.wallpaper, appearance.animationsEnabled, displayWallpaper]);

  useEffect(() => {
    return () => {
      Object.values(closeTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      closeTimersRef.current = {};
      if (wallpaperFinalizeTimerRef.current) {
        window.clearTimeout(wallpaperFinalizeTimerRef.current);
      }
      if (wallpaperFrameRef.current) {
        window.cancelAnimationFrame(wallpaperFrameRef.current);
      }
    };
  }, []);

  function finalizeWallpaperFade() {
    if (!isWallpaperFading || !nextWallpaper) return;
    if (wallpaperFinalizeTimerRef.current) {
      window.clearTimeout(wallpaperFinalizeTimerRef.current);
      wallpaperFinalizeTimerRef.current = null;
    }
    setDisplayWallpaper(nextWallpaper);
    setNextWallpaper(null);
    setIsWallpaperFading(false);
  }

  const openSettingsSection = useCallback(
    (sectionId: string) => {
      setSettingsSectionRequest(sectionId);
      setIsSettingsSearchOpen(false);
      setSettingsSearchQuery("");
      const section = SETTINGS_SECTIONS.find(
        (entry) => entry.id === sectionId,
      );
      if (typeof window !== "undefined" && section) {
        setRecentActions(
          pushRecentCommandAction(window.localStorage, {
            key: `settings:${section.id}`,
            kind: "settings-section",
            title: section.label,
            subtitle: "Settings section",
            sectionId: section.id,
          }),
        );
      }
      openWindow("settings");
    },
    [openWindow],
  );

  function handleDockClick(id: string) {
    if (id === "apps") {
      // "Show Desktop" — minimize all visible windows.
      // If every open window is already minimized, restore them all.
      const visibleWindows = openWindows.filter(
        (w) => !minimizedWindows.includes(w),
      );
      if (visibleWindows.length > 0) {
        setMinimizedWindows((prev) => [
          ...prev,
          ...visibleWindows.filter((w) => !prev.includes(w)),
        ]);
        setFocusedWindow(null);
      } else {
        // All already minimized — restore all so the user can get back
        setMinimizedWindows([]);
      }
      return;
    }

    if (
      id !== "files" &&
      id !== "settings" &&
      id !== "app-store" &&
      id !== "terminal" &&
      id !== "monitor" &&
      id !== "notifications" &&
      id !== "app-settings" &&
      id !== "disk-manager"
    )
      return;

    if (id === "terminal" && currentUser?.isDemoMode) {
      toast.info("Terminal is disabled in demo mode.");
      return;
    }

    if (typeof window !== "undefined") {
      const metadata = {
        files: { title: "Open Files", subtitle: "Folder and file browser" },
        settings: { title: "Open Settings", subtitle: "System preferences" },
        "app-store": {
          title: "Open App Store",
          subtitle: "Browse and install apps",
        },
        terminal: { title: "Open Terminal", subtitle: "Shell and logs" },
        monitor: { title: "Open Monitor", subtitle: "System performance" },
        notifications: { title: "Open Notifications", subtitle: "Activity feed" },
        "app-settings": { title: "Open App Settings", subtitle: "App configuration" },
        "disk-manager": { title: "Open Disk Manager", subtitle: "Storage management" },
      }[id];

      if (metadata) {
        setRecentActions(
          pushRecentCommandAction(window.localStorage, {
            key: `window:${id}`,
            kind: "window",
            title: metadata.title,
            subtitle: metadata.subtitle,
            windowId: id,
          }),
        );
      }
    }

    openWindow(id);
  }

  function getWindowZ(id: string) {
    return focusedWindow === id ? 110 : 100;
  }

  const requestTerminalCommand = useCallback(
    (command: string) => {
      terminalCommandIdRef.current += 1;
      setTerminalMode("interactive");
      setTerminalCommandRequest({
        id: terminalCommandIdRef.current,
        command,
      });
      openWindow("terminal");
    },
    [openWindow],
  );

  const requestLogsCommand = useCallback(
    (command: string) => {
      terminalCommandIdRef.current += 1;
      setTerminalMode("logs");
      setTerminalCommandRequest({
        id: terminalCommandIdRef.current,
        command,
      });
      openWindow("terminal");
    },
    [openWindow],
  );

  const openCommandPaletteWindow = useCallback(
    (windowId: "files" | "settings" | "app-store" | "terminal" | "monitor" | "notifications" | "app-settings" | "disk-manager") => {
      if (typeof window !== "undefined") {
        const spec = DESKTOP_WINDOWS_BY_ID.get(windowId);
        if (!spec) return;

        setRecentActions(
          pushRecentCommandAction(window.localStorage, {
            key: `window:${windowId}`,
            kind: "window",
            title: `Open ${spec.title}`,
            subtitle: spec.commandSubtitle,
            windowId,
          }),
        );
      }
      setIsSettingsSearchOpen(false);
      setSettingsSearchQuery("");
      openWindow(windowId);
    },
    [openWindow],
  );

  const openAppStoreSearch = useCallback(
    (input: { search: string; appId?: string }) => {
      appStoreLaunchNonceRef.current += 1;
      setAppStoreLaunchRequest({
        nonce: appStoreLaunchNonceRef.current,
        search: input.search,
        appId: input.appId,
      });
      if (typeof window !== "undefined") {
        setRecentActions(
          pushRecentCommandAction(window.localStorage, {
            key: input.appId
              ? `app-store:app:${input.appId}`
              : `app-store:search:${input.search.trim().toLowerCase()}`,
            kind: "app-store-search",
            title: input.appId ? input.search : `Search "${input.search}"`,
            subtitle: "App Store app result",
            search: input.search,
            appId: input.appId,
          }),
        );
      }
      setIsSettingsSearchOpen(false);
      setSettingsSearchQuery("");
      openWindow("app-store");
    },
    [openWindow],
  );

  const handleSelectRecentAction = useCallback(
    (action: RecentCommandAction) => {
      if (action.kind === "window") {
        openCommandPaletteWindow(action.windowId);
        return;
      }

      if (action.kind === "settings-section") {
        openSettingsSection(action.sectionId);
        return;
      }

      openAppStoreSearch({
        search: action.search,
        appId: action.appId,
      });
    },
    [openAppStoreSearch, openCommandPaletteWindow, openSettingsSection],
  );

  useEffect(() => {
    function handleKeyboardShortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setLockState(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSettingsSearchOpen(true);
        setSettingsSearchQuery("");
        return;
      }
      if (e.key === "Escape" && isSettingsSearchOpen) {
        e.preventDefault();
        setIsSettingsSearchOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyboardShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleKeyboardShortcut, true);
    };
  }, [isSettingsSearchOpen, setLockState]);

  const handleLogout = useCallback(async () => {
    setIsLogoutPending(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      setLockState(false);
      setIsLogoutPending(false);
      router.replace("/login");
      router.refresh();
    }
  }, [router, setLockState]);

  const handleUnlock = useCallback(
    async (password: string) => {
      const response = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error ?? "Invalid password");
      }

      setLockState(false);
    },
    [setLockState],
  );

  if (!isLockStateHydrated || !rebootRecovery.isHydrated) {
    return <SessionLoadingScreen />;
  }

  if (rebootRecovery.isActive) {
    if (rebootRecovery.action === "update") {
      return (
        <UpdateRecoveryScreen
          manageRecovery={false}
          phaseOverride={rebootRecovery.phase}
        />
      );
    }

    return (
      <RebootOverlay
        action={rebootRecovery.action ?? "reboot"}
        phase={rebootRecovery.phase}
      />
    );
  }

  if (isLoadingUser) {
    return <SessionLoadingScreen />;
  }

  // What each window puts inside its frame. Everything else about a window —
  // title, icon, size — comes from DESKTOP_WINDOWS. Typing this as a full
  // Record means a window added to the catalog will not compile until it has
  // contents here.
  const windowBodies: Record<DesktopWindowId, DesktopWindowBody> = {
    files: {
      render: () => <FileManager />,
    },
    settings: {
      render: () => (
        <SettingsPanel
          appearance={appearance}
          wallpaperOptions={wallpapers}
          accentOptions={accentColors}
          onAppearanceChange={updateAppearance}
          wallpaperAccentColor={wallpaperAccentColor}
          selectedSection={settingsSectionRequest}
          onOpenDiskManager={() => openWindow("disk-manager")}
        />
      ),
    },
    monitor: {
      render: () => <Monitor />,
    },
    notifications: {
      render: () => <NotificationsPanel />,
    },
    "app-store": {
      render: () => (
        <AppStore
          onOpenCustomInstall={() => openWindow("custom-install")}
          launchRequest={appStoreLaunchRequest}
        />
      ),
    },
    "custom-install": {
      render: () => (
        <AppConfiguratorPanel
          context="custom_install"
          onClose={() => closeWindow("custom-install")}
        />
      ),
    },
    "app-settings": {
      enabled: appSettingsTarget !== null,
      title: appSettingsTarget
        ? `${appSettingsTarget.appName} Settings`
        : undefined,
      onClose: () => {
        closeWindow("app-settings");
        setAppSettingsTarget(null);
      },
      render: () =>
        appSettingsTarget ? (
          <AppConfiguratorPanel
            context="installed_edit"
            target={appSettingsTarget}
            actions={{ saveAppSettings: shellStoreActions.saveAppSettings }}
            onClose={() => {
              closeWindow("app-settings");
              setAppSettingsTarget(null);
            }}
          />
        ) : null,
    },
    terminal: {
      title: terminalMode === "logs" ? "Container Logs" : "Terminal",
      render: () => (
        <Terminal
          commandRequest={terminalCommandRequest}
          readOnly={terminalMode === "logs"}
        />
      ),
    },
    "disk-manager": {
      render: () => <DiskManager />,
    },
  };

  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      // 100dvh, not 100vh: when the on-screen keyboard opens, the dynamic
      // viewport shrinks and the shell shrinks with it, so the focused input
      // stays visible. 100vh keeps the old height and the keyboard covers what
      // you are typing into. The h-screen class remains as the fallback for
      // engines that drop the dvh declaration.
      style={{ height: "100dvh" }}
    >
      {/* Wallpaper Background */}
      <div className="absolute inset-0">
        <div
          className={`absolute inset-0 bg-cover bg-center bg-no-repeat ${
            appearance.animationsEnabled
              ? "transition-opacity duration-500 ease-out"
              : ""
          } ${
            nextWallpaper && isWallpaperFading ? "opacity-0" : "opacity-100"
          }`}
          style={{
            willChange: "opacity",
            backgroundImage: `url('${displayWallpaper}')`,
          }}
        />
        {nextWallpaper && (
          <div
            className={`absolute inset-0 bg-cover bg-center bg-no-repeat ${
              appearance.animationsEnabled
                ? "transition-opacity duration-500 ease-out"
                : ""
            } ${isWallpaperFading ? "opacity-100" : "opacity-0"}`}
            style={{
              willChange: "opacity",
              backgroundImage: `url('${nextWallpaper}')`,
            }}
            onTransitionEnd={finalizeWallpaperFade}
          />
        )}
        {/* Depth vignette — transparent at center, darker at edges.
            Three stops rather than two: a single linear ramp reads as a grey
            wash laid over the wallpaper, and it pooled hardest at the lower
            right, which is exactly where the widget column sits. Easing the
            falloff and holding the clear centre wider keeps the depth without
            the smear behind the cards.

            The vertical radius exceeds the viewport on purpose: anchored at the
            top, a 100% radius reaches full darkness exactly at the bottom edge,
            so the taller the screen the deeper the widget column sank into it.
            Overshooting means the gradient is still climbing when it runs out
            of screen, which keeps tall displays as light as short ones. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_140%_135%_at_50%_0%,transparent_50%,rgba(0,0,0,0.08)_76%,rgba(0,0,0,0.18)_100%)]" />
        {/* Bottom ambient shadow (dock area) */}
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/30 to-transparent" />
      </div>

      {/* Desktop Content */}
      <div className="relative z-10 flex h-full flex-col">
        {/* Demo mode floating badge — overlays the top of the widget column */}
        {currentUser?.isDemoMode && (
          <div className="fixed top-14 right-5 z-50 hidden xl:flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1.5 backdrop-blur-md shadow-lg shadow-black/20">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-semibold text-primary tracking-tight">
              Demo
            </span>
            <span className="text-xs text-foreground/50">· read-only</span>
          </div>
        )}

        {isSettingsSearchOpen && (
          <CommandPalette
            open={isSettingsSearchOpen}
            onOpenChange={setIsSettingsSearchOpen}
            query={settingsSearchQuery}
            onQueryChange={setSettingsSearchQuery}
            settingsSections={filteredSettingsSections}
            recentActions={recentActions}
            onOpenSettingsSection={openSettingsSection}
            onOpenAppStoreSearch={openAppStoreSearch}
            onOpenWindow={openCommandPaletteWindow}
            onSelectRecentAction={handleSelectRecentAction}
          />
        )}

        {/* Status Bar */}
        <StatusBar
          onLock={() => setLockState(true)}
          onLogout={handleLogout}
          isLogoutPending={isLogoutPending}
          onOpenNotifications={() => openWindow("notifications")}
        />

        {/* Main Desktop Area */}
        <div className="m-12 flex min-h-0 flex-1 overflow-hidden" data-tour="apps">
          {/* App Grid (scrollable center) */}
          <AppGrid
            iconSize={appIconSize}
            animationsEnabled={appearance.animationsEnabled}
            onViewLogs={(target) => setLogsTarget(target)}
            onOpenTerminal={({ containerName }) =>
              requestTerminalCommand(
                `docker exec ${containerName} /bin/sh -c "pwd && ls"`,
              )
            }
            onOpenSettings={(target) => {
              setAppSettingsTarget(target);
              openWindow("app-settings");
            }}
          />

          {/* System Widgets (right sidebar) */}
          <SystemWidgets />
        </div>

        {/* Windows — one element per catalog entry, contents from windowBodies */}
        {DESKTOP_WINDOWS.map((spec) => {
          const body = windowBodies[spec.id];
          if (!openWindows.includes(spec.id)) return null;
          if (body.enabled === false) return null;
          const SpecIcon = spec.icon;

          return (
            <Window
              key={spec.id}
              title={body.title ?? spec.title}
              icon={<SpecIcon className={spec.iconClassName} />}
              onClose={body.onClose ?? (() => closeWindow(spec.id))}
              onMinimize={() => minimizeWindow(spec.id)}
              defaultWidth={spec.defaultWidth}
              defaultHeight={spec.defaultHeight}
              zIndex={getWindowZ(spec.id)}
              dockPosition={appearance.dockPosition}
              onFocus={() => setFocusedWindow(spec.id)}
              isClosing={closingWindows.includes(spec.id)}
              isMinimized={minimizedWindows.includes(spec.id)}
              animationsEnabled={appearance.animationsEnabled}
            >
              {body.render()}
            </Window>
          );
        })}

        {/* Command Palette Badge — floats above the dock */}
        <div className="fixed bottom-[5.75rem] left-1/2 z-40 -translate-x-1/2">
          <button
            onClick={() => { setIsSettingsSearchOpen(true); setSettingsSearchQuery(""); }}
            className="system-pill-surface flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-foreground/30 transition-colors hover:text-foreground/55"
            aria-label="Open command palette"
          >
            <Search className="size-2.5 shrink-0" />
            <span className="font-mono text-3xs tracking-widest">⌘K</span>
          </button>
        </div>

        {/* Dock */}
        <Dock
          activeWindows={openWindows}
          focusedWindow={focusedWindow}
          onItemClick={handleDockClick}
          position={appearance.dockPosition}
          animationsEnabled={appearance.animationsEnabled}
          iconSize={appIconSize}
        />

        {isLocked && (
          <LockScreen
            wallpaper={appearance.wallpaper}
            username={currentUser?.username ?? "user"}
            onUnlock={handleUnlock}
            onLogout={handleLogout}
          />
        )}
      </div>

      <AppLogsDialog target={logsTarget} onClose={() => setLogsTarget(null)} />

      <DesktopTour open={tour.isOpen} onClose={tour.close} />
    </div>
  );
}
