import type { DesktopLanguageCode, DesktopTimeFormat } from "@/lib/desktop/preferences";

export function hour12FromTimeFormat(timeFormat: DesktopTimeFormat) {
  return timeFormat === "12h";
}

export function formatClockTime(
  date: Date,
  options: { locale: DesktopLanguageCode; timeFormat: DesktopTimeFormat },
) {
  return date.toLocaleTimeString(options.locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: hour12FromTimeFormat(options.timeFormat),
  });
}

export function formatClockDate(date: Date, locale: DesktopLanguageCode) {
  return date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatLockScreenTime(
  date: Date,
  options: { locale: DesktopLanguageCode; timeFormat: DesktopTimeFormat },
) {
  return date.toLocaleTimeString(options.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: hour12FromTimeFormat(options.timeFormat),
  });
}

export function formatLockScreenDate(date: Date, locale: DesktopLanguageCode) {
  return date.toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
