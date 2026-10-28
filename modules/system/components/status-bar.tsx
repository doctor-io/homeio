"use client";

import { BatteryFull, Bell, CloudSun, Tailscale } from "@/components/icons/platform-icons";
import { BatteryPopover } from "@/modules/system/components/status-bar/battery-popover";
import { DatePickerPopover } from "@/modules/system/components/status-bar/date-picker-popover";
import { NotificationPopover } from "@/modules/system/components/status-bar/notification-popover";
import type {
  StatusBarProps,
  StatusPopover,
} from "@/modules/system/components/status-bar/types";
import { useStatusBarData } from "@/modules/system/components/status-bar/use-status-bar-data";
import {
  formatDate,
  formatTemperature,
  formatTime,
} from "@/modules/system/components/status-bar/utils";
import { WeatherPopover } from "@/modules/system/components/status-bar/weather-popover";
import { TailscalePopover } from "@/modules/system/components/status-bar/tailscale-popover";
import {
  EthernetIcon,
  WifiStatusIcon,
} from "@/modules/system/components/status-bar/wifi-icons";
import { WifiPopover } from "@/modules/system/components/status-bar/wifi-popover";
import { useCurrentWeather } from "@/modules/system/hooks/useCurrentWeather";
import { useNetworkEventsSse } from "@/modules/system/hooks/useNetworkEventsSse";
import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import Image from "next/image";
import { useEffect, useState } from "react";

function toTitleCaseUsername(value: string | null) {
  if (!value) return "User";

  return value
    .trim()
    .split(/[\s_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function StatusBar({
  onLock: _onLock,
  onLogout: _onLogout,
  isLogoutPending: _isLogoutPending = false,
  onOpenNotifications,
  onOpenSettings,
}: StatusBarProps) {
  const {
    metrics,
    networkStatus,
    username,
    isDemoMode,
    batteryText,
    isWifiConnected,
    isEthernet,
    isMetricsError,
    wifiIconClassName,
    notifications,
    unreadCount,
    markAllRead,
    clearNotifications,
  } = useStatusBarData();
  const { preferences, isHydrated: preferencesHydrated } = useDesktopPreferences();
  const { data: weather } = useCurrentWeather();
  useNetworkEventsSse(true);
  const weatherText = formatTemperature(weather?.current.temperatureC);

  const [now, setNow] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [activePopover, setActivePopover] = useState<StatusPopover | null>(
    null,
  );

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  function closePopovers() {
    setActivePopover(null);
  }

  function togglePopover(popover: StatusPopover) {
    setActivePopover((current) => (current === popover ? null : popover));
  }

  return (
    <header className="fixed top-3 left-1/2 -translate-x-1/2 z-50 min-w-[50%] w-auto max-w-[96vw]">
      {/* Blur is on a separate element so it doesn't create a Firefox stacking context over the flyout popovers */}
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-2xl border border-white/[0.09] pointer-events-none"
        style={{
          background: "var(--system-surface)",
          backdropFilter: "blur(40px) saturate(160%)",
          boxShadow:
            "var(--system-shadow-floating), inset 0 1px 0 rgba(255,255,255,0.12)",
        }}
      />
      <div
        className="relative flex items-center gap-1.5 px-3.5 py-1.5"
      >
        <div className="flex items-center gap-2 pr-3 border-r border-glass-border/50">
          <div className="flex size-6 items-center justify-center overflow-hidden rounded-[8px] bg-primary/12 ring-1 ring-primary/25 shadow-sm shadow-black/20">
            <Image
              src="/icon.png"
              alt="Homeio"
              width={24}
              height={24}
              className="size-5"
            />
          </div>
          <span className="text-xs font-semibold tracking-tight text-foreground/90">
            <span className="xl:hidden">{`Hi, ${toTitleCaseUsername(username)}`}</span>
            <span className="hidden xl:inline">{`Welcome back, ${toTitleCaseUsername(username)}`}</span>
          </span>
        </div>

        <div className="flex-1 min-w-4" />

        <div className="flex items-center">
          <div className="relative">
            <button
              onClick={() => togglePopover("weather")}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/[0.07] transition-colors cursor-pointer"
              aria-label="Weather"
            >
              <CloudSun className="size-3.5 text-status-amber" />
              <span className="text-xs text-foreground font-medium">
                {weatherText}
              </span>
            </button>
            {activePopover === "weather" && (
              <WeatherPopover
                weather={weather}
                onClose={closePopovers}
                onSetLocation={onOpenSettings ? () => { closePopovers(); onOpenSettings(); } : undefined}
              />
            )}
          </div>

          <div className="w-px h-3.5 bg-glass-border" />

          <div className="relative">
            <button
              onClick={() => togglePopover("wifi")}
              className="p-1.5 rounded-lg hover:bg-white/[0.07] transition-colors cursor-pointer"
              aria-label="WiFi networks"
            >
              {isEthernet ? (
                <EthernetIcon className={wifiIconClassName} />
              ) : (
                <WifiStatusIcon
                  connected={!isMetricsError && isWifiConnected}
                  quality={
                    networkStatus?.signalPercent ??
                    metrics?.wifi.signalPercent ??
                    null
                  }
                  className={wifiIconClassName}
                />
              )}
            </button>
            {activePopover === "wifi" && (
              <WifiPopover
                metrics={metrics}
                networkStatus={networkStatus}
                isDemoMode={isDemoMode}
                onClose={closePopovers}
              />
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => togglePopover("battery")}
              className="flex items-center gap-1 p-1.5 rounded-lg hover:bg-white/[0.07] transition-colors cursor-pointer"
              aria-label="Battery status"
            >
              <BatteryFull className="size-4 text-status-green" />
              <span className="text-xs text-muted-foreground font-medium">
                {batteryText}
              </span>
            </button>
            {activePopover === "battery" && (
              <BatteryPopover
                battery={metrics?.battery}
                onClose={closePopovers}
              />
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => togglePopover("tailscale")}
              className="p-1.5 rounded-lg hover:bg-white/[0.07] transition-colors cursor-pointer"
              aria-label="Tailscale status"
            >
              <Tailscale className="size-4 text-primary" />
            </button>
            {activePopover === "tailscale" && (
              <TailscalePopover onClose={closePopovers} />
            )}
          </div>

          <div className="w-px h-4 bg-glass-border" />

          <div className="relative">
            <button
              onClick={() => togglePopover("notifications")}
              className="relative p-1.5 rounded-lg hover:bg-white/[0.07] transition-colors cursor-pointer"
              aria-label="Notifications"
            >
              <Bell className="size-4 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-bold shadow-sm shadow-black/30">
                  {unreadCount}
                </span>
              )}
            </button>
            {activePopover === "notifications" && (
              <NotificationPopover
                notifications={notifications}
                onMarkAllRead={markAllRead}
                onClearAll={clearNotifications}
                onClose={closePopovers}
                onViewAll={() => { closePopovers(); onOpenNotifications?.(); }}
              />
            )}
          </div>

          <div className="w-px h-4 bg-glass-border" />

          {/* {onLock ? (
            <button
              onClick={onLock}
              className="p-1.5 rounded-lg hover:bg-white/[0.07] transition-colors cursor-pointer"
              aria-label="Lock screen"
              title="Lock screen"
            >
              <Lock className="size-4 text-muted-foreground" />
            </button>
          ) : null}

          {onLogout ? (
            <LogoutButton onLogout={onLogout} isPending={isLogoutPending} />
          ) : null}

          {onLock || onLogout ? (
            <div className="w-px h-4 bg-glass-border" />
          ) : null} */}

          <div className="relative flex items-center gap-2 pl-1">
            <button
              onClick={() => togglePopover("date")}
              className="flex flex-row items-end rounded-lg px-1.5 gap-2 py-1 text-right transition-colors hover:bg-white/[0.07] cursor-pointer"
              aria-label="Open date picker"
            >
              <span className="hidden xl:text-xs xl:leading-tight xl:text-muted-foreground xl:block">
                {now && preferencesHydrated ? formatDate(now, preferences.language) : "---"}
              </span>
              <span className="text-xs font-medium text-foreground leading-tight">
                {now && preferencesHydrated
                  ? formatTime(now, {
                      locale: preferences.language,
                      timeFormat: preferences.timeFormat,
                    })
                  : "--:--"}
              </span>
            </button>
            {activePopover === "date" && (
              <DatePickerPopover
                onClose={closePopovers}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
