import {
  formatClockDate,
  formatClockTime,
} from "@/lib/desktop/clock-format";
import type {
  DesktopLanguageCode,
  DesktopTimeFormat,
} from "@/lib/desktop/preferences";

export type StatusBarClockOptions = {
  locale: DesktopLanguageCode;
  timeFormat: DesktopTimeFormat;
};

export function formatTime(date: Date, options: StatusBarClockOptions) {
  return formatClockTime(date, options);
}

export function formatDate(date: Date, locale: DesktopLanguageCode) {
  return formatClockDate(date, locale);
}

export function formatTemperature(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${Math.round(value)}°`;
}

export function formatDuration(seconds: number) {
  const total = Math.max(Math.floor(seconds), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export function safePercent(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(Math.round(value), 100));
}

export function formatRelativeTime(isoTimestamp: string, now = new Date()) {
  const target = new Date(isoTimestamp);
  const deltaSeconds = Math.max(
    Math.floor((now.getTime() - target.getTime()) / 1000),
    0,
  );

  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)} min ago`;
  if (deltaSeconds < 86_400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86_400)}d ago`;
}
