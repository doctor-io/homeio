"use client";

import { Droplets, Sun, Thermometer, Wind } from "@/components/icons/platform-icons";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
} from "@/components/icons/platform-icons";
import { PopoverShell } from "@/modules/system/components/status-bar/popover-shell";
import { formatTemperature } from "@/modules/system/components/status-bar/utils";
import type { WeatherSnapshot } from "@/lib/shared/contracts/weather";

type WeatherPopoverProps = {
  weather: WeatherSnapshot | undefined;
  onClose: () => void;
  /** Why there is no weather; while it is still loading, leave it unset. */
  problem?: "no-location" | "failed";
  onSetLocation?: () => void;
};

export function WeatherPopover({ weather, onClose, problem, onSetLocation }: WeatherPopoverProps) {
  if (!weather && problem && onSetLocation) {
    return (
      <PopoverShell onClose={onClose} className="w-72">
        <div className="flex flex-col items-start gap-3 p-4">
          <CloudSun className="size-8 text-status-amber" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {problem === "failed" ? "Weather unavailable" : "No weather yet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {problem === "failed"
                ? "This browser could not reach the weather service. Check its internet connection, or pick another location."
                : "Choose a city in Settings. It works on every device, without asking the browser for its location."}
            </p>
          </div>
          <button
            type="button"
            onClick={onSetLocation}
            className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Set a location
          </button>
        </div>
      </PopoverShell>
    );
  }


  const mainTemperature = formatTemperature(weather?.current.temperatureC);
  const feelsLike = formatTemperature(weather?.current.feelsLikeC);
  const hasMainTemperature = typeof weather?.current.temperatureC === "number";
  const hasFeelsLike = typeof weather?.current.feelsLikeC === "number";
  const dailyForecast = weather?.dailyForecast ?? [];

  return (
    <PopoverShell onClose={onClose} className="w-72">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">
              {weather?.location.label ?? "Unknown location"}
            </p>
            <div className="flex items-end gap-1">
              <span className="text-3xl font-light text-foreground">
                {mainTemperature}
              </span>
              <span className="text-lg text-muted-foreground mb-0.5">
                {hasMainTemperature ? "C" : ""}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {weather?.current.condition ?? "Unknown"}
            </p>
          </div>
          <Thermometer className="size-10 text-status-amber" />
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Droplets className="size-3" /> Hum {weather?.current.humidityPercent ?? "--"}%
          </span>
          <span className="flex items-center gap-1">
            <Wind className="size-3" /> Wind {weather?.current.windSpeedKph ?? "--"} km/h
          </span>
          <span className="flex items-center gap-1">
            <Sun className="size-3" /> Feels {feelsLike}
            {hasFeelsLike ? "C" : ""}
          </span>
        </div>

        <div className="mt-4 border-t border-glass-border pt-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Next 5 Days
          </p>
          <div className="flex items-stretch gap-1.5">
            {dailyForecast.length > 0 ? (
              dailyForecast.map((day) => (
                <div
                  key={day.date}
                  className="flex flex-1 min-w-0 flex-col items-center gap-1 rounded-lg bg-secondary/25 px-1.5 py-2 text-xs text-muted-foreground"
                >
                  <span className="text-2xs font-medium text-foreground">
                    {new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "short",
                    })}
                  </span>
                  <ForecastIcon weatherCode={day.weatherCode} />
                  <span className="max-w-full truncate text-2xs">{day.condition}</span>
                  <span className="font-mono text-2xs text-foreground">
                    {formatTemperature(day.tempMaxC)}/{formatTemperature(day.tempMinC)}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No forecast available</span>
            )}
          </div>
        </div>
      </div>
    </PopoverShell>
  );
}

function ForecastIcon({ weatherCode }: { weatherCode: number | null }) {
  if (weatherCode === null) {
    return <Cloud className="size-3.5 text-muted-foreground" />;
  }
  if (weatherCode === 0) {
    return <Sun className="size-3.5 text-status-amber" />;
  }
  if (weatherCode === 1 || weatherCode === 2) {
    return <CloudSun className="size-3.5 text-status-amber" />;
  }
  if (weatherCode === 3) {
    return <Cloud className="size-3.5 text-muted-foreground" />;
  }
  if (weatherCode === 45 || weatherCode === 48) {
    return <CloudFog className="size-3.5 text-muted-foreground" />;
  }
  if (weatherCode >= 51 && weatherCode <= 57) {
    return <CloudDrizzle className="size-3.5 text-primary" />;
  }
  if ((weatherCode >= 61 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82)) {
    return <CloudRain className="size-3.5 text-primary" />;
  }
  if ((weatherCode >= 71 && weatherCode <= 77) || weatherCode === 85 || weatherCode === 86) {
    return <CloudSnow className="size-3.5 text-primary" />;
  }
  if (weatherCode === 95 || weatherCode === 96 || weatherCode === 99) {
    return <CloudLightning className="size-3.5 text-status-amber" />;
  }
  return <Cloud className="size-3.5 text-muted-foreground" />;
}
