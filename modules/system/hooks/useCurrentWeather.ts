"use client";

import { useQuery } from "@tanstack/react-query";
import type { WeatherSnapshot } from "@/lib/shared/contracts/weather";
import { queryKeys } from "@/lib/shared/query-keys";
import { useUserLocation } from "@/modules/system/hooks/useUserLocation";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
};

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRounded(value: number | null, precision = 1) {
  if (value === null) return null;
  return Number(value.toFixed(precision));
}

function mapWeatherCodeToCondition(code: number | null) {
  if (code === null) return "Unknown";
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return "Unknown";
}

function buildDailyForecast(daily: OpenMeteoResponse["daily"]) {
  const dates = daily?.time ?? [];
  const weatherCodes = daily?.weather_code ?? [];
  const maxTemps = daily?.temperature_2m_max ?? [];
  const minTemps = daily?.temperature_2m_min ?? [];
  const entriesCount = Math.min(
    dates.length,
    weatherCodes.length,
    maxTemps.length,
    minTemps.length,
  );
  if (entriesCount <= 0) return [] as WeatherSnapshot["dailyForecast"];

  const startIndex = entriesCount > 5 ? 1 : 0;
  const endExclusive = Math.min(startIndex + 5, entriesCount);
  const forecast: WeatherSnapshot["dailyForecast"] = [];
  for (let index = startIndex; index < endExclusive; index += 1) {
    const weatherCode = toNumber(weatherCodes[index]);
    forecast.push({
      date: dates[index] ?? "",
      weatherCode,
      condition: mapWeatherCodeToCondition(weatherCode),
      tempMaxC: toRounded(toNumber(maxTemps[index]), 1),
      tempMinC: toRounded(toNumber(minTemps[index]), 1),
    });
  }
  return forecast;
}

function formatLocationLabel(coords: { city?: string; country?: string }) {
  if (coords.city && coords.country) return `${coords.city}, ${coords.country}`;
  return coords.city ?? coords.country ?? "Current location";
}

async function fetchCurrentWeather(
  coords: Coordinates & { city?: string; country?: string },
) {
  const params = new URLSearchParams({
    latitude: coords.latitude.toString(),
    longitude: coords.longitude.toString(),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
  });
  const endpoint = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  const response = await fetch(endpoint, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch weather (${response.status})`);
  }

  const json = (await response.json()) as OpenMeteoResponse;
  const weatherCode = toNumber(json.current?.weather_code);
  const locationLabel = formatLocationLabel(coords);

  return {
    timestamp: new Date().toISOString(),
    source: "navigator",
    location: {
      label: locationLabel,
      latitude: toRounded(coords.latitude, 4),
      longitude: toRounded(coords.longitude, 4),
    },
    current: {
      temperatureC: toRounded(toNumber(json.current?.temperature_2m), 1),
      feelsLikeC: toRounded(toNumber(json.current?.apparent_temperature), 1),
      humidityPercent: toRounded(
        toNumber(json.current?.relative_humidity_2m),
        0,
      ),
      windSpeedKph: toRounded(toNumber(json.current?.wind_speed_10m), 1),
      weatherCode,
      condition: mapWeatherCodeToCondition(weatherCode),
    },
    dailyForecast: buildDailyForecast(json.daily),
  } satisfies WeatherSnapshot;
}

export function useCurrentWeather() {
  const { location, loading } = useUserLocation();
  const coords = location;

  const query = useQuery({
    queryKey: queryKeys.currentWeather(
      coords?.latitude ?? null,
      coords?.longitude ?? null,
    ),
    queryFn: () => {
      if (!coords) throw new Error("Missing coordinates");
      return fetchCurrentWeather(coords);
    },
    enabled: Boolean(coords),
    staleTime: 300_000,
    refetchInterval: 600_000,
  });

  // Lets the UI tell "still locating" from "no location at all".
  return { ...query, hasLocation: Boolean(coords), locationPending: loading };
}
