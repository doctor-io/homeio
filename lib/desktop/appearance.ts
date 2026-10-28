export type DesktopTheme = "dark" | "light" | "system"
export type DesktopIconSize = "small" | "medium" | "large"
export type DesktopFontSize = "compact" | "default" | "large" | "extra-large"
export type DockPosition = "bottom" | "left" | "right"
export type DesktopGlassStyle = "clear" | "tinted"

export type WallpaperOption = {
  id: string
  name: string
  src: string
}

export type AccentColorOption = {
  name: string
  value: string
}

export type RadiusPreset = {
  name: string
  value: number
  description: string
}

export type WeatherLocation = {
  latitude: number
  longitude: number
  city?: string
  country?: string
}

export type AppearanceSettings = {
  theme: DesktopTheme
  accentColor: string
  wallpaper: string
  radius: number
  glassStyle: DesktopGlassStyle
  iconSize: DesktopIconSize
  fontSize: DesktopFontSize
  animationsEnabled: boolean
  dockPosition: DockPosition
  /** Server-wide weather location; null falls back to the browser's geolocation. */
  weatherLocation: WeatherLocation | null
}

export const APPEARANCE_CHANGED_EVENT = "desktop.appearance.changed"
export const APPEARANCE_RADIUS_MIN = 2
export const APPEARANCE_RADIUS_MAX = 24
export const DEFAULT_APPEARANCE_RADIUS = 12

export const ACCENT_COLORS: AccentColorOption[] = [
  { name: "Orange", value: "#FF6000" },
  { name: "Teal", value: "oklch(0.72 0.14 190)" },
  { name: "Blue", value: "oklch(0.65 0.2 250)" },
  { name: "Green", value: "oklch(0.72 0.18 155)" },
  { name: "Amber", value: "oklch(0.78 0.15 80)" },
  { name: "Rose", value: "oklch(0.65 0.2 10)" },
  { name: "Violet", value: "oklch(0.6 0.2 300)" },
]

export const WALLPAPER_OPTIONS: WallpaperOption[] = [
  ...Array.from({ length: 21 }).map((_, index) => {
    const imageNumber = index + 1
    return {
      id: `wallpaper-${imageNumber}`,
      name: `Wallpaper ${imageNumber}`,
      src: `/images/${imageNumber}.jpg`,
    }
  }),
  { id: "wallpaper-classic", name: "Classic", src: "/images/wallpaper.jpg" },
]

export const RADIUS_PRESETS: RadiusPreset[] = [
  { name: "Sharp", value: 4, description: "Squared corners" },
  { name: "Default", value: DEFAULT_APPEARANCE_RADIUS, description: "Balanced corners" },
  { name: "Soft", value: 20, description: "Rounder panels" },
]

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: "dark",
  accentColor: ACCENT_COLORS[0].value,
  wallpaper: WALLPAPER_OPTIONS[0].src,
  radius: DEFAULT_APPEARANCE_RADIUS,
  glassStyle: "clear",
  iconSize: "medium",
  fontSize: "default",
  animationsEnabled: true,
  dockPosition: "bottom",
  weatherLocation: null,
}

const desktopThemes: DesktopTheme[] = ["dark", "light", "system"]
const iconSizes: DesktopIconSize[] = ["small", "medium", "large"]
const fontSizes: DesktopFontSize[] = ["compact", "default", "large", "extra-large"]
const dockPositions: DockPosition[] = ["bottom", "left", "right"]
const accentValues = new Set(ACCENT_COLORS.map((c) => c.value))
const wallpaperValues = new Set(WALLPAPER_OPTIONS.map((w) => w.src))

export const AUTO_ACCENT_VALUE = "auto"

function isDesktopTheme(value: unknown): value is DesktopTheme {
  return typeof value === "string" && desktopThemes.includes(value as DesktopTheme)
}

function isIconSize(value: unknown): value is DesktopIconSize {
  return typeof value === "string" && iconSizes.includes(value as DesktopIconSize)
}

function isFontSize(value: unknown): value is DesktopFontSize {
  return typeof value === "string" && fontSizes.includes(value as DesktopFontSize)
}

function isDockPosition(value: unknown): value is DockPosition {
  return typeof value === "string" && dockPositions.includes(value as DockPosition)
}

function sanitizeRadius(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_APPEARANCE_SETTINGS.radius
  }

  return Math.min(
    APPEARANCE_RADIUS_MAX,
    Math.max(APPEARANCE_RADIUS_MIN, Math.round(value)),
  )
}

function sanitizePlaceName(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().slice(0, 100)
  return trimmed || undefined
}

export function sanitizeWeatherLocation(input: unknown): WeatherLocation | null {
  if (!input || typeof input !== "object") return null
  const value = input as Record<string, unknown>
  const { latitude, longitude } = value
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  return {
    latitude,
    longitude,
    city: sanitizePlaceName(value.city),
    country: sanitizePlaceName(value.country),
  }
}

export function sanitizeAppearanceSettings(input: unknown): AppearanceSettings {
  const value = (input ?? {}) as Partial<AppearanceSettings>
  const sanitizedTheme =
    value.theme === "system"
      ? DEFAULT_APPEARANCE_SETTINGS.theme
      : isDesktopTheme(value.theme)
        ? value.theme
        : DEFAULT_APPEARANCE_SETTINGS.theme

  return {
    theme: sanitizedTheme,
    accentColor:
      value.accentColor === AUTO_ACCENT_VALUE ||
      (typeof value.accentColor === "string" && accentValues.has(value.accentColor))
        ? value.accentColor
        : DEFAULT_APPEARANCE_SETTINGS.accentColor,
    wallpaper:
      typeof value.wallpaper === "string" && wallpaperValues.has(value.wallpaper)
        ? value.wallpaper
        : DEFAULT_APPEARANCE_SETTINGS.wallpaper,
    radius: sanitizeRadius(value.radius),
    glassStyle:
      value.glassStyle === "clear" || value.glassStyle === "tinted"
        ? value.glassStyle
        : DEFAULT_APPEARANCE_SETTINGS.glassStyle,
    iconSize: isIconSize(value.iconSize) ? value.iconSize : DEFAULT_APPEARANCE_SETTINGS.iconSize,
    fontSize: isFontSize(value.fontSize) ? value.fontSize : DEFAULT_APPEARANCE_SETTINGS.fontSize,
    animationsEnabled:
      typeof value.animationsEnabled === "boolean"
        ? value.animationsEnabled
        : DEFAULT_APPEARANCE_SETTINGS.animationsEnabled,
    dockPosition: isDockPosition(value.dockPosition)
      ? value.dockPosition
      : DEFAULT_APPEARANCE_SETTINGS.dockPosition,
    weatherLocation: sanitizeWeatherLocation(value.weatherLocation),
  }
}

export function dispatchAppearanceChangedEvent() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(APPEARANCE_CHANGED_EVENT))
}
