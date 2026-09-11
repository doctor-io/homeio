"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { useAppearanceSettings } from "@/modules/shell/hooks/useAppearanceSettings"

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
    return "dark"
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
  const lastSavedRef = useRef<string | null>(null)
  const { data: savedAppearance } = useAppearanceSettings()

  useEffect(() => {
    if (!savedAppearance) return
    setAppearance(savedAppearance)
    lastSavedRef.current = JSON.stringify(savedAppearance)
    setLoaded(true)
  }, [savedAppearance])

  // Extract wallpaper color whenever wallpaper changes (or on first load if auto is active)
  useEffect(() => {
    const key = appearance.wallpaper
    if (extractingRef.current === key) return
    extractingRef.current = key
    extractWallpaperColor(appearance.wallpaper).then(setWallpaperAccentColor)
  }, [appearance.wallpaper])

  useEffect(() => {
    const resolved = appearance.accentColor === AUTO_ACCENT_VALUE
      ? (wallpaperAccentColor ?? DEFAULT_APPEARANCE_SETTINGS.accentColor)
      : appearance.accentColor
    applyAppearanceToDom({ ...appearance, accentColor: resolved })
  }, [appearance, wallpaperAccentColor])

  useEffect(() => {
    if (!loaded) return
    const serialized = JSON.stringify(appearance)
    // Hydrating used to trip this effect and PUT back exactly what had just
    // been read, so every desktop load wrote unchanged settings to the server.
    if (serialized === lastSavedRef.current) return
    lastSavedRef.current = serialized
    saveAppearance(appearance);
  }, [appearance, loaded])

  useEffect(() => {
    if (appearance.theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const handleThemeChange = () => {
      applyAppearanceToDom(appearance)
    }
    media.addEventListener("change", handleThemeChange)
    return () => media.removeEventListener("change", handleThemeChange)
  }, [appearance])

  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
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
