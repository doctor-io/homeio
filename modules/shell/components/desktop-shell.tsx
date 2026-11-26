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
import { APP_ICONS, DEVICE_ICONS } from "@/components/icons/icon-assets";
import { OsIcon } from "@/components/icons/OsIcon";
import {
  AlertRegular,
  ChevronRightRegular,
  FolderRegular,
  GridRegular,
  HardDriveRegular,
  HomeRegular,
  LockClosedRegular,
  PulseRegular,
  SearchRegular,
  SettingsRegular,
  ShoppingBagRegular,
  SignOutRegular,
  WindowConsoleRegular,
} from "@fluentui/react-icons";
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
import { ContainerSettingsPanel } from "@/modules/apps/components/configurator/container-settings-panel";
import {
  StoreActionsProvider,
  useSharedStoreActions,
} from "@/modules/apps/hooks/StoreActionsContext";
import { FileManager } from "@/modules/files/components/file-manager";
import { SettingsPanel } from "@/modules/settings/components/settings";
import { CommandPalette } from "@/modules/shell/components/command-palette";
import { useDesktopAppearance } from "@/modules/shell/hooks/useDesktopAppearance";
import { useRebootRecovery } from "@/modules/shell/hooks/useRebootRecovery";
import { useServerConnection } from "@/modules/shell/hooks/useServerConnection";
import { Monitor } from "@/modules/system/components/monitor";
import { DiskManager } from "@/modules/system/components/disk-manager";
import { NotificationsPanel } from "@/modules/system/components/notifications-panel";
import { StatusBar } from "@/modules/system/components/status-bar";
import { SystemWidgets } from "@/modules/system/components/system-widgets";
import { UpdateReminder } from "@/modules/system/components/update-reminder";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ConnectionLostScreen } from "./connection-lost-screen";
import { Dock } from "./dock";
import { LockScreen } from "./lock-screen";
import { RebootOverlay } from "./reboot-overlay";
import { SessionLoadingScreen } from "./session-loading-screen";
import { Terminal, type TerminalAttachRequest } from "./terminal";
import { UpdateRecoveryScreen } from "./update-recovery-screen";
import { Window } from "./window";

const MOBILE_QUERY = "(width < 48rem), (pointer: coarse) and (hover: none)";
const subscribeMobile = (callback: () => void) => {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
const getMobileSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
const getServerMobileSnapshot = () => false;

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
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerMobileSnapshot);
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
  const [mobilePage, setMobilePage] = useState<"home" | "more">("home");
  const mobileParents = useRef<Record<string, string | null>>({});
  const [isLocked, setIsLocked] = useState(false);
  const [isLockStateHydrated, setIsLockStateHydrated] = useState(false);
  const [isLogoutPending, setIsLogoutPending] = useState(false);
  const [isSettingsSearchOpen, setIsSettingsSearchOpen] = useState(false);
  const [settingsSearchQuery, setSettingsSearchQuery] = useState("");
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<
    { id: string } | null
  >(null);
  const [appStoreLaunchRequest, setAppStoreLaunchRequest] = useState<{
    nonce: number;
    search?: string;
    appId?: string;
  } | null>(null);
  const [recentActions, setRecentActions] = useState<RecentCommandAction[]>([]);
  const [terminalAttachRequest, setTerminalAttachRequest] =
    useState<TerminalAttachRequest>(null);
  const [appSettingsTarget, setAppSettingsTarget] =
    useState<AppActionTarget | null>(null);
  const [logsTarget, setLogsTarget] = useState<AppActionTarget | null>(null);
  const shellStoreActions = useSharedStoreActions();
  const terminalAttachIdRef = useRef(0);
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
  const serverConnection = useServerConnection(
    rebootRecovery.isHydrated && !rebootRecovery.isActive,
  );

  useEffect(() => {
    if (!isMobile) return;
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      overflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = previous.overflow;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      body.style.overscrollBehavior = previous.bodyOverscroll;
    };
  }, [isMobile]);

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
    if (isMobile && id !== focusedWindow) {
      mobileParents.current[id] = focusedWindow ?? (mobilePage === "more" ? "__more" : null);
    }
    if (closeTimersRef.current[id]) {
      window.clearTimeout(closeTimersRef.current[id]);
      delete closeTimersRef.current[id];
    }
    setClosingWindows((prev) => prev.filter((w) => w !== id));
    setMinimizedWindows((prev) => prev.filter((w) => w !== id));
    setOpenWindows((prev) => {
      if (isMobile) return [...prev.filter((windowId) => windowId !== id), id];
      if (prev.includes(id)) return prev;
      return [...prev, id];
    });
    setFocusedWindow(id);
  }, [focusedWindow, isMobile, mobilePage]);

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

      if (isMobile) {
        const parent = mobileParents.current[id];
        delete mobileParents.current[id];
        setOpenWindows((prev) => prev.filter((windowId) => windowId !== id));
        setClosingWindows((prev) => prev.filter((windowId) => windowId !== id));
        setMinimizedWindows((prev) => prev.filter((windowId) => windowId !== id));
        setMobilePage(parent === "__more" ? "more" : "home");
        setFocusedWindow(parent && parent !== "__more" && openWindows.includes(parent) ? parent : null);
        return;
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
    [appearance.animationsEnabled, finalizeCloseWindow, isMobile, openWindows],
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
      setSettingsSectionRequest({ id: sectionId });
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

  function selectMobileTab(id: "home" | "files" | "app-store" | "monitor" | "more") {
    if (id === "home" || id === "more") {
      setFocusedWindow(null);
      setMobilePage(id);
      return;
    }
    openWindow(id);
    mobileParents.current[id] = null;
    setMobilePage("home");
  }

  function getWindowZ(id: string) {
    return focusedWindow === id ? 110 : 100;
  }

  const openContainerTerminal = useCallback(
    (container: string) => {
      terminalAttachIdRef.current += 1;
      setTerminalAttachRequest({
        id: terminalAttachIdRef.current,
        container,
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
    <div className={isMobile ? "relative h-[100dvh] w-full overflow-hidden overscroll-none" : "relative h-[100dvh] w-full overflow-hidden"}>
      {/* Wallpaper Background */}
      {!isMobile && <div className="absolute inset-0">
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
      </div>}

      {/* Desktop Content */}
      <div data-tool-open={isMobile && focusedWindow ? "" : undefined} className={`relative z-10 flex h-full flex-col ${isMobile ? "mobile-workspace bg-[var(--mobile-canvas)] text-foreground" : ""}`}>
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
        {!isMobile && <StatusBar
          onLock={() => setLockState(true)}
          onLogout={handleLogout}
          isLogoutPending={isLogoutPending}
          onOpenNotifications={() => openWindow("notifications")}
          onOpenSettings={() => openWindow("settings")}
        />}

        {/* Launcher and desktop area */}
        {(!isMobile || !focusedWindow) && <div className={isMobile
          ? "relative isolate flex min-h-0 flex-1 flex-col overflow-hidden pt-[var(--mobile-safe-top)] pr-[var(--mobile-safe-right)] pb-[var(--mobile-dock-clearance)] pl-[var(--mobile-safe-left)]"
          : "m-12 flex min-h-0 flex-1 overflow-hidden"}>
          {isMobile && mobilePage === "home" && (displayWallpaper || appearance.wallpaper) && (
            <div
              aria-hidden="true"
              className="mobile-wallpaper pointer-events-none absolute inset-0 -z-10"
              style={{ backgroundImage: `url('${displayWallpaper ?? appearance.wallpaper}')` }}
            />
          )}
          {isMobile && <header className="mx-auto flex min-h-[var(--mobile-header-height)] w-full max-w-[calc(var(--mobile-home-width)+var(--mobile-gutter)*2)] shrink-0 items-center gap-2 px-[var(--mobile-gutter)]">
            <NextImage src="/icon-192.png" alt="" width={28} height={28} className="size-7 rounded-lg shadow-md" />
            <h1 className={`min-w-0 flex-1 truncate text-base font-semibold tracking-[-0.035em] ${mobilePage === "home" ? "mobile-wallpaper-label" : ""}`}>{mobilePage === "more" ? "More" : "Homeio"}</h1>
            {currentUser?.isDemoMode && <span className={`text-xs ${mobilePage === "home" ? "mobile-wallpaper-label" : "text-muted-foreground"}`}>Demo</span>}
            <div className="mobile-glass flex shrink-0 items-center rounded-full">
              <button type="button" aria-label="Search" onClick={() => { setIsSettingsSearchOpen(true); setSettingsSearchQuery(""); }} className="grid size-11 cursor-pointer touch-manipulation place-items-center rounded-l-full active:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"><SearchRegular className="size-[1.15rem]" aria-hidden="true" /></button>
              <button type="button" aria-label="Notifications" onClick={() => openWindow("notifications")} className="grid size-11 cursor-pointer touch-manipulation place-items-center rounded-r-full active:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"><AlertRegular className="size-[1.15rem]" aria-hidden="true" /></button>
            </div>
          </header>}
          {isMobile && mobilePage === "more" ? (
            <div className="@container/mobile-more mx-auto min-h-0 w-full max-w-[calc(var(--mobile-home-width)+var(--mobile-gutter)*2)] flex-1 overflow-y-auto overscroll-contain px-[var(--mobile-gutter)] py-3">
              <div className="grid items-start gap-4 @lg/mobile-more:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="mobile-list-group">
                  {([
                    ["settings", "Settings", SettingsRegular],
                    ["disk-manager", "Disks", HardDriveRegular],
                    ["terminal", "Terminal", WindowConsoleRegular],
                  ] as const).map(([id, label, Icon]) => (
                    <button key={id} type="button" onClick={() => handleDockClick(id)} className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-b border-[var(--mobile-divider)] px-3 text-left text-sm font-semibold last:border-b-0 active:bg-primary/10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary">
                      <span className="mobile-window-icon grid size-8 shrink-0 place-items-center rounded-lg" aria-hidden="true"><OsIcon src={id === "disk-manager" ? DEVICE_ICONS.drive : APP_ICONS[id]} className="size-6 object-contain" fallback={<Icon className="size-5 text-[var(--mobile-accent-text)]" />} /></span>
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
                      <ChevronRightRegular aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
                <div className="mobile-list-group">
                  <button type="button" onClick={() => setLockState(true)} className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-b border-[var(--mobile-divider)] px-3 text-left text-sm font-medium active:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"><span className="grid size-8 shrink-0 place-items-center text-muted-foreground"><LockClosedRegular className="size-5" aria-hidden="true" /></span>Lock</button>
                  <button type="button" disabled={isLogoutPending} onClick={handleLogout} className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-3 text-left text-sm font-medium active:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary disabled:opacity-50"><span className="grid size-8 shrink-0 place-items-center text-muted-foreground"><SignOutRegular className="size-5" aria-hidden="true" /></span>{isLogoutPending ? "Signing out…" : "Sign out"}</button>
                </div>
              </div>
            </div>
          ) : <AppGrid
            mobile={isMobile}
            onBrowseStore={() => selectMobileTab("app-store")}
            iconSize={appIconSize}
            animationsEnabled={appearance.animationsEnabled}
            onViewLogs={(target) => setLogsTarget(target)}
            onOpenTerminal={({ containerName }) => openContainerTerminal(containerName)}
            onOpenSettings={(target) => {
              setAppSettingsTarget(target);
              openWindow("app-settings");
            }}
          />}
          {!isMobile && <SystemWidgets />}
        </div>}

        {/* Windows */}
        {openWindows.includes("files") && (
          <Window
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "files"}
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
            <FileManager
              keyboardEnabled={
                !minimizedWindows.includes("files") &&
                !closingWindows.includes("files") &&
                (!isMobile || focusedWindow === "files")
              }
            />
          </Window>
        )}

        {openWindows.includes("settings") && (
          <Window
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "settings"}
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
              sectionRequest={settingsSectionRequest}
              onOpenDiskManager={() => openWindow("disk-manager")}
            />
          </Window>
        )}

        {openWindows.includes("monitor") && (
          <Window
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "monitor"}
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
            <Monitor onOpenDiskManager={() => openWindow("disk-manager")} />
          </Window>
        )}

        {openWindows.includes("notifications") && (
          <Window
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "notifications"}
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
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "app-store"}
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
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "custom-install"}
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
              withinMobileWindow={isMobile}
              onClose={() => closeWindow("custom-install")}
            />
          </Window>
        )}

        {openWindows.includes("app-settings") && appSettingsTarget && (
          <Window
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "app-settings"}
            title={`${appSettingsTarget.appName} Settings`}
            icon={<Settings className="size-4 text-primary" />}
            onClose={() => {
              closeWindow("app-settings");
              setAppSettingsTarget(null);
            }}
            onMinimize={() => minimizeWindow("app-settings")}
            defaultWidth={appSettingsTarget.unmanaged ? 560 : 920}
            defaultHeight={appSettingsTarget.unmanaged ? 460 : 700}
            zIndex={getWindowZ("app-settings")}
            dockPosition={appearance.dockPosition}
            onFocus={() => setFocusedWindow("app-settings")}
            isClosing={closingWindows.includes("app-settings")}
            isMinimized={minimizedWindows.includes("app-settings")}
            animationsEnabled={appearance.animationsEnabled}
          >
            {appSettingsTarget.unmanaged ? (
              <ContainerSettingsPanel
                key={appSettingsTarget.containerName}
                target={appSettingsTarget}
                onClose={() => {
                  closeWindow("app-settings");
                  setAppSettingsTarget(null);
                }}
              />
            ) : (
              <AppConfiguratorPanel
                context="installed_edit"
                withinMobileWindow={isMobile}
                target={appSettingsTarget}
                actions={{ saveAppSettings: shellStoreActions.saveAppSettings }}
                onClose={() => {
                  closeWindow("app-settings");
                  setAppSettingsTarget(null);
                }}
              />
            )}
          </Window>
        )}

        {openWindows.includes("terminal") && (
          <Window
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "terminal"}
            title="Terminal"
            icon={<TerminalSquare className="size-4 text-emerald-400" />}
            onClose={() => {
              closeWindow("terminal");
              setTerminalAttachRequest(null);
            }}
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
            <Terminal attachRequest={terminalAttachRequest} />
          </Window>
        )}

        {openWindows.includes("disk-manager") && (
          <Window
            mobile={isMobile}
            inactive={isMobile && focusedWindow !== "disk-manager"}
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

        {isMobile && <nav aria-label="Primary navigation" className="mobile-glass mobile-dock z-[120]">
          {([
            ["home", "Home", HomeRegular], ["files", "Files", FolderRegular],
            ["app-store", "Store", ShoppingBagRegular], ["monitor", "Monitor", PulseRegular],
            ["more", "More", GridRegular],
          ] as const).map(([id, label, Icon]) => {
            const active = focusedWindow === id || (!focusedWindow && mobilePage === id) ||
              (id === "app-store" && focusedWindow === "custom-install") ||
              (id === "more" && ["settings", "disk-manager", "terminal"].includes(focusedWindow ?? ""));
            const iconSrc = id === "home" ? "/icon-192.png" : APP_ICONS[id];
            return (
              <button key={id} type="button" aria-label={label} aria-current={active ? "page" : undefined} onClick={() => selectMobileTab(id)} className="mobile-dock-button">
                <span className="mobile-dock-icon grid size-10 place-items-center" aria-hidden="true">
                  {iconSrc ? <OsIcon src={iconSrc} className="size-8 object-contain drop-shadow-sm" fallback={<Icon className="size-6" />} /> : <Icon className="size-6" />}
                </span>
              </button>
            );
          })}
        </nav>}

        {/* Command Palette Badge — floats above the dock */}
        {!isMobile && <div className="fixed bottom-[5.75rem] left-1/2 z-40 -translate-x-1/2">
          <button
            onClick={() => { setIsSettingsSearchOpen(true); setSettingsSearchQuery(""); }}
            className="system-pill-surface flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-foreground/30 transition-colors hover:text-foreground/55"
            aria-label="Open command palette"
          >
            <Search className="size-2.5 shrink-0" />
            <span className="font-mono text-[9px] tracking-widest">⌘K</span>
          </button>
        </div>}

        {/* Dock */}
        {!isMobile && <Dock
          activeWindows={openWindows}
          focusedWindow={focusedWindow}
          onItemClick={handleDockClick}
          position={appearance.dockPosition}
          animationsEnabled={appearance.animationsEnabled}
        />}

        <UpdateReminder
          enabled={!isLocked && !currentUser?.isDemoMode}
          onOpenDetails={() => openSettingsSection("updates")}
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

      {serverConnection.phase !== "online" ? (
        <ConnectionLostScreen
          phase={serverConnection.phase}
          isBrowserOffline={serverConnection.isBrowserOffline}
          lostSince={serverConnection.lostSince}
          serverRestarted={serverConnection.serverRestarted}
          runtime={serverConnection.runtime}
          logoSrc={serverConnection.logoSrc}
          onCheckNow={serverConnection.checkNow}
        />
      ) : null}
    </div>
  );
}
