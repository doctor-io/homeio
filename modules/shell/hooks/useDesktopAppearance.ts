"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { queryKeys } from "@/lib/shared/query-keys"
import {
  type AppearanceSettings,
  ACCENT_COLORS,
  AUTO_ACCENT_VALUE,
  DEFAULT_APPEARANCE_SETTINGS,
  type DesktopFontSize,
  type DesktopIconSize,
  type DesktopTheme,
  sanitizeAppearanceSettings,
  WALLPAPER_OPTIONS,
} from "@/lib/desktop/appearance"
import { extractWallpaperColor } from "@/lib/desktop/wallpaper-color"

const fontSizeScaleMap: Record<DesktopFontSize, number> = {
  compact: 14,
  default: 16,
  large: 18,
  "extra-large": 20,
}

const iconSizeMap: Record<DesktopIconSize, "small" | "medium" | "large"> = {
  small: "small",
  medium: "medium",
  large: "large",
}

function resolveTheme(theme: DesktopTheme) {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }
  return theme
}

function applyAppearanceToDom(settings: AppearanceSettings) {
  const root = document.documentElement
  const resolvedTheme = resolveTheme(settings.theme)

  root.dataset.desktopTheme = resolvedTheme
  root.dataset.desktopAnimations = settings.animationsEnabled ? "on" : "off"
  root.classList.toggle("dark", resolvedTheme === "dark")
  root.style.colorScheme = resolvedTheme
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = resolvedTheme === "dark" ? "#171615" : "#f4efe8"
  })
  root.style.fontSize = `${fontSizeScaleMap[settings.fontSize]}px`
  root.style.setProperty("--radius", `${settings.radius}px`)
  root.style.setProperty("--primary", settings.accentColor)
  root.style.setProperty("--accent", settings.accentColor)
  root.style.setProperty("--ring", settings.accentColor)
  root.style.setProperty("--sidebar-primary", settings.accentColor)
  root.style.setProperty("--chart-1", settings.accentColor)
  root.style.setProperty("--system-tint-amount", "0%")
  if (resolvedTheme === "dark") {
    root.style.setProperty(
      "--dock",
      settings.glassStyle === "tinted"
        ? "oklch(0.04 0.006 250 / 0.75)"
        : "oklch(0.14 0.015 250 / 0.18)",
    )
  } else {
    root.style.setProperty(
      "--dock",
      settings.glassStyle === "tinted"
        ? "oklch(0.55 0.008 250 / 0.78)"
        : "oklch(0.96 0.006 250 / 0.70)",
    )
  }
}

async function fetchAppearance(): Promise<AppearanceSettings> {
  const res = await fetch("/api/v1/settings/appearance", { cache: "no-store" });
  if (!res.ok) return DEFAULT_APPEARANCE_SETTINGS;
  const json = await res.json() as { data: AppearanceSettings; hasSavedTheme?: boolean };
  const appearance = sanitizeAppearanceSettings(json.data);
  if (json.hasSavedTheme === false && window.matchMedia("(width < 48rem), (pointer: coarse) and (hover: none)").matches) {
    appearance.theme = "system";
  }
  return appearance;
}

async function saveAppearance(appearance: AppearanceSettings): Promise<void> {
  await fetch("/api/v1/settings/appearance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(appearance),
  });
}

export function useDesktopAppearance() {
  const [appearance, setAppearance] = useState<AppearanceSettings>(DEFAULT_APPEARANCE_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [wallpaperAccentColor, setWallpaperAccentColor] = useState<string | null>(null)
  const extractingRef = useRef<string | null>(null)
  const shouldSaveRef = useRef(false)
  const queryClient = useQueryClient()
  const { setTheme } = useTheme()

  useEffect(() => {
    fetchAppearance().then((saved) => {
      setAppearance(saved)
      setLoaded(true)
    });
  }, [])

  // Extract wallpaper color whenever wallpaper changes (or on first load if auto is active)
  useEffect(() => {
    const key = appearance.wallpaper
    if (extractingRef.current === key) return
    extractingRef.current = key
    extractWallpaperColor(appearance.wallpaper).then(setWallpaperAccentColor)
  }, [appearance.wallpaper])

  useEffect(() => {
    if (!loaded) return
    const resolved = appearance.accentColor === AUTO_ACCENT_VALUE
      ? (wallpaperAccentColor ?? DEFAULT_APPEARANCE_SETTINGS.accentColor)
      : appearance.accentColor
    const theme = appearance.theme
    const resolvedAppearance = { ...appearance, theme, accentColor: resolved }
    setTheme(theme)
    const apply = () => applyAppearanceToDom(resolvedAppearance)
    apply()
    if (theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [appearance, loaded, setTheme, wallpaperAccentColor])

  useEffect(() => {
    if (!loaded) return
    queryClient.setQueryData(queryKeys.weatherLocation, appearance.weatherLocation)
    if (shouldSaveRef.current) {
      shouldSaveRef.current = false
      saveAppearance(appearance)
    }
  }, [appearance, loaded, queryClient])

  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
    shouldSaveRef.current = true
    setAppearance((prev) => sanitizeAppearanceSettings({ ...prev, ...patch }))
  }, [])

  const appIconSize = useMemo(() => iconSizeMap[appearance.iconSize], [appearance.iconSize])

  return {
    appearance,
    /** False until the saved appearance has replaced the defaults. */
    isAppearanceLoaded: loaded,
    updateAppearance,
    wallpapers: WALLPAPER_OPTIONS,
    accentColors: ACCENT_COLORS,
    appIconSize,
    wallpaperAccentColor,
  }
}
