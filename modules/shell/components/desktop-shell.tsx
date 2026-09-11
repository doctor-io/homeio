"use client";

import {
  Activity,
  Bell,
  FolderOpen,
  HardDrive,
  Package,
  Search,
  Settings,
  ShoppingBag,
  TerminalSquare,
} from "@/components/icons/platform-icons";
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
import { SettingsPanel } from "@/modules/settings/components/settings";
import { CommandPalette } from "@/modules/shell/components/command-palette";
import { useDesktopAppearance } from "@/modules/shell/hooks/useDesktopAppearance";
import { useRebootRecovery } from "@/modules/shell/hooks/useRebootRecovery";
import { Monitor } from "@/modules/system/components/monitor";
import { DiskManager } from "@/modules/system/components/disk-manager";
import { NotificationsPanel } from "@/modules/system/components/notifications-panel";
import { StatusBar } from "@/modules/system/components/status-bar";
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

const WINDOW_CLOSE_ANIMATION_MS = 180;
// Long enough to read as a change rather than a flicker; the image is already
// cached and preloaded by the time this runs, so the wait is the animation.
const WALLPAPER_FADE_MS = 900;
const SETTINGS_SEARCH_SECTIONS = [
  { id: "general", label: "General" },
  { id: "network", label: "Network" },
  { id: "storage", label: "Storage" },
  { id: "docker", label: "Docker" },
  { id: "users", label: "Users & Access" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "backup", label: "Backup & Restore" },
  { id: "updates", label: "Updates" },
  { id: "appearance", label: "Appearance" },
  { id: "power", label: "Power" },
] as const;

export function DesktopShell() {
  return (
    <StoreActionsProvider>
      <DesktopShellInner />
    </StoreActionsProvider>
  );
}

function DesktopShellInner() {
  const router = useRouter();
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
  const [displayWallpaper, setDisplayWallpaper] = useState<string | null>(null);
  const [nextWallpaper, setNextWallpaper] = useState<string | null>(null);
  const [isWallpaperFading, setIsWallpaperFading] = useState(false);
  const closeTimersRef = useRef<Record<string, number>>({});
  const wallpaperFinalizeTimerRef = useRef<number | null>(null);
  const wallpaperFrameRef = useRef<number | null>(null);
  const wallpaperTransitionIdRef = useRef(0);
  const appStoreLaunchNonceRef = useRef(0);
  const {
    appearance,
    isAppearanceLoaded,
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
    if (!query) return SETTINGS_SEARCH_SECTIONS;
    return SETTINGS_SEARCH_SECTIONS.filter((section) =>
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

  // The first real wallpaper is assigned outright. Cross-fading into it would
  // animate a change the operator never made — and did, on every reload.
  useEffect(() => {
    if (!isAppearanceLoaded || displayWallpaper !== null) return;
    setDisplayWallpaper(appearance.wallpaper);
  }, [appearance.wallpaper, displayWallpaper, isAppearanceLoaded]);

  useEffect(() => {
    if (displayWallpaper === null) return;
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
      const section = SETTINGS_SEARCH_SECTIONS.find(
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
        }[windowId];

        setRecentActions(
          pushRecentCommandAction(window.localStorage, {
            key: `window:${windowId}`,
            kind: "window",
            title: metadata.title,
            subtitle: metadata.subtitle,
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

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Wallpaper Background */}
      <div className="absolute inset-0">
        <div
          className={`absolute inset-0 bg-cover bg-center bg-no-repeat ${
            appearance.animationsEnabled ? "transition-opacity ease-out" : ""
          } ${
            nextWallpaper && isWallpaperFading ? "opacity-0" : "opacity-100"
          }`}
          style={{
            willChange: "opacity",
            // Driven by the constant the finalize timer uses, so the two cannot
            // drift apart the way 500ms of CSS and a 420ms timer had.
            transitionDuration: `${WALLPAPER_FADE_MS}ms`,
            backgroundImage: displayWallpaper ? `url('${displayWallpaper}')` : undefined,
          }}
        />
        {nextWallpaper && (
          <div
            className={`absolute inset-0 bg-cover bg-center bg-no-repeat ${
              appearance.animationsEnabled ? "transition-opacity ease-out" : ""
            } ${isWallpaperFading ? "opacity-100" : "opacity-0"}`}
            style={{
              willChange: "opacity",
              transitionDuration: `${WALLPAPER_FADE_MS}ms`,
              backgroundImage: `url('${nextWallpaper}')`,
            }}
            onTransitionEnd={finalizeWallpaperFade}
          />
        )}
        {/* Depth vignette — transparent at center, darker at edges */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_130%_100%_at_50%_0%,transparent_28%,rgba(0,0,0,0.42)_100%)]" />
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
        <div className="m-12 flex min-h-0 flex-1 overflow-hidden">
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

        {/* Windows */}
        {openWindows.includes("files") && (
          <Window
            title="Files"
            icon={<FolderOpen className="size-4 text-sky-400" />}
            onClose={() => closeWindow("files")}
            onMinimize={() => minimizeWindow("files")}
            defaultWidth={1100}
            defaultHeight={679}
            zIndex={getWindowZ("files")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("files")}
            isClosing={closingWindows.includes("files")}
            isMinimized={minimizedWindows.includes("files")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <FileManager />
          </Window>
        )}

        {openWindows.includes("settings") && (
          <Window
            title="Settings"
            icon={<Settings className="size-4 text-muted-foreground" />}
            onClose={() => closeWindow("settings")}
            onMinimize={() => minimizeWindow("settings")}
            defaultWidth={860}
            defaultHeight={620}
            zIndex={getWindowZ("settings")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("settings")}
            isClosing={closingWindows.includes("settings")}
            isMinimized={minimizedWindows.includes("settings")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <SettingsPanel
              appearance={appearance}
              wallpaperOptions={wallpapers}
              accentOptions={accentColors}
              onAppearanceChange={updateAppearance}
              wallpaperAccentColor={wallpaperAccentColor}
              selectedSection={settingsSectionRequest}
              onOpenDiskManager={() => openWindow("disk-manager")}
            />
          </Window>
        )}

        {openWindows.includes("monitor") && (
          <Window
            title="Monitor"
            icon={<Activity className="size-4 text-primary" />}
            onClose={() => closeWindow("monitor")}
            onMinimize={() => minimizeWindow("monitor")}
            defaultWidth={1120}
            defaultHeight={700}
            zIndex={getWindowZ("monitor")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("monitor")}
            isClosing={closingWindows.includes("monitor")}
            isMinimized={minimizedWindows.includes("monitor")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <Monitor />
          </Window>
        )}

        {openWindows.includes("notifications") && (
          <Window
            title="Notifications"
            icon={<Bell className="size-4 text-primary" />}
            onClose={() => closeWindow("notifications")}
            onMinimize={() => minimizeWindow("notifications")}
            defaultWidth={640}
            defaultHeight={520}
            zIndex={getWindowZ("notifications")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("notifications")}
            isClosing={closingWindows.includes("notifications")}
            isMinimized={minimizedWindows.includes("notifications")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <NotificationsPanel />
          </Window>
        )}

        {openWindows.includes("app-store") && (
          <Window
            title="App Store"
            icon={<ShoppingBag className="size-4 text-sky-400" />}
            onClose={() => closeWindow("app-store")}
            onMinimize={() => minimizeWindow("app-store")}
            defaultWidth={1080}
            defaultHeight={680}
            zIndex={getWindowZ("app-store")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("app-store")}
            isClosing={closingWindows.includes("app-store")}
            isMinimized={minimizedWindows.includes("app-store")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <AppStore
              onOpenCustomInstall={() => openWindow("custom-install")}
              launchRequest={appStoreLaunchRequest}
            />
          </Window>
        )}

        {openWindows.includes("custom-install") && (
          <Window
            title="Install Custom App"
            icon={<Package className="size-4 text-primary" />}
            onClose={() => closeWindow("custom-install")}
            onMinimize={() => minimizeWindow("custom-install")}
            defaultWidth={720}
            defaultHeight={600}
            zIndex={getWindowZ("custom-install")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("custom-install")}
            isClosing={closingWindows.includes("custom-install")}
            isMinimized={minimizedWindows.includes("custom-install")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <AppConfiguratorPanel
              context="custom_install"
              onClose={() => closeWindow("custom-install")}
            />
          </Window>
        )}

        {openWindows.includes("app-settings") && appSettingsTarget && (
          <Window
            title={`${appSettingsTarget.appName} Settings`}
            icon={<Settings className="size-4 text-primary" />}
            onClose={() => {
              closeWindow("app-settings");
              setAppSettingsTarget(null);
            }}
            onMinimize={() => minimizeWindow("app-settings")}
            defaultWidth={920}
            defaultHeight={700}
            zIndex={getWindowZ("app-settings")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("app-settings")}
            isClosing={closingWindows.includes("app-settings")}
            isMinimized={minimizedWindows.includes("app-settings")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <AppConfiguratorPanel
              context="installed_edit"
              target={appSettingsTarget}
              actions={{ saveAppSettings: shellStoreActions.saveAppSettings }}
              onClose={() => {
                closeWindow("app-settings");
                setAppSettingsTarget(null);
              }}
            />
          </Window>
        )}

        {openWindows.includes("terminal") && (
          <Window
            title={terminalMode === "logs" ? "Container Logs" : "Terminal"}
            icon={<TerminalSquare className="size-4 text-emerald-400" />}
            onClose={() => closeWindow("terminal")}
            onMinimize={() => minimizeWindow("terminal")}
            defaultWidth={980}
            defaultHeight={620}
            zIndex={getWindowZ("terminal")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("terminal")}
            isClosing={closingWindows.includes("terminal")}
            isMinimized={minimizedWindows.includes("terminal")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <Terminal
              commandRequest={terminalCommandRequest}
              readOnly={terminalMode === "logs"}
            />
          </Window>
        )}

        {openWindows.includes("disk-manager") && (
          <Window
            title="Disk Manager"
            icon={<HardDrive className="size-4 text-amber-400" />}
            onClose={() => closeWindow("disk-manager")}
            onMinimize={() => minimizeWindow("disk-manager")}
            defaultWidth={980}
            defaultHeight={640}
            zIndex={getWindowZ("disk-manager")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("disk-manager")}
            isClosing={closingWindows.includes("disk-manager")}
            isMinimized={minimizedWindows.includes("disk-manager")}
            animationsEnabled={appearance.animationsEnabled}
          >
            <DiskManager />
          </Window>
        )}

        {/* Command Palette Badge — floats above the dock */}
        <div className="fixed bottom-[5.75rem] left-1/2 z-40 -translate-x-1/2">
          <button
            onClick={() => { setIsSettingsSearchOpen(true); setSettingsSearchQuery(""); }}
            className="system-pill-surface flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-foreground/30 transition-colors hover:text-foreground/55"
            aria-label="Open command palette"
          >
            <Search className="size-2.5 shrink-0" />
            <span className="font-mono text-[9px] tracking-widest">⌘K</span>
          </button>
        </div>

        {/* Dock */}
        <Dock
          activeWindows={openWindows}
          focusedWindow={focusedWindow}
          onItemClick={handleDockClick}
          position={appearance.dockPosition}
          animationsEnabled={appearance.animationsEnabled}
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
    </div>
  );
}
